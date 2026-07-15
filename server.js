import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { Agent } from './agent.js';
import { runSandboxed } from './sandbox.js';
import { createWorkspace, parseWorkspaceManifest, runWorkspaceTest } from './workspace.js';
import { RunRegistry } from './run-registry.js';
import { capabilities, isCompatibleProtocol, validateClientCommand } from './packages/protocol/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS_DIR = join(__dirname, 'transcripts');
const WORKSPACES_DIR = process.env.TRIFORCE_WORKSPACE_ROOT || join(homedir(), '.local', 'share', 'triforce', 'workspaces');
if (process.env.TRIFORCE_TRANSCRIPTS === '1') await mkdir(TRANSCRIPTS_DIR, { recursive: true, mode: 0o700 });
const AUTH_TOKEN = process.env.TRIFORCE_TOKEN || randomBytes(32).toString('hex');
if (!process.env.TRIFORCE_TOKEN) console.warn(`TRIFORCE_TOKEN was not set; generated one-time token: ${AUTH_TOKEN}`);
const runRegistry = new RunRegistry();

const RATES = {
  'claude-sonnet-4-6': [3.00,  15.00],
  'claude-opus-4-7':   [15.00, 75.00],
  'claude-haiku-4-5':  [0.80,  4.00],
  'gemini-2.5-flash':  [0.15,  0.60],
  'gemini-2.5-pro':    [1.25,  10.00],
  'gpt-4o':            [2.50,  10.00],
  'gpt-4o-mini':       [0.15,  0.60],
  'gpt-4.1':           [2.00,  8.00],
  'gpt-4.1-mini':      [0.40,  1.60],
  'claude-cli-default': [0.00, 0.00],
  'codex-cli-default': [0.00, 0.00],
  'agy-cli-default':   [0.00, 0.00],
};
const ALLOWED_MODELS = new Map([
  ['anthropic', new Set(['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'])],
  ['google', new Set(['gemini-2.5-flash', 'gemini-2.5-pro'])],
  ['openai', new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'])],
  ['claude-cli', new Set(['claude-cli-default'])],
  ['codex-cli', new Set(['codex-cli-default'])],
  ['agy-cli', new Set(['agy-cli-default'])],
]);

const SYSTEM_PROMPTS = {
  architect: 'You are the Architect agent in the Triforce system. Your job is to analyze a coding task and produce a clear, structured implementation plan. Output ONLY the plan as numbered steps. No code. No markdown formatting. No preamble.',
  developer: 'You are the Developer agent in the Triforce system. You receive an implementation plan and your job is to write the code. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  reviewer:  'You are the Reviewer agent in the Triforce system. You receive code written by another agent and the terminal output from executing that code. Analyze both and produce a clear Pass/Fail verdict. If Pass: confirm what worked. If Fail: identify exactly what went wrong and what should be fixed. Be concise and specific.',
};

const SYSTEM_PROMPTS_MODE2 = {
  designer: 'You are the Prompt Designer agent in the Triforce system. Your job is to analyze a coding task and produce a clear, detailed specification/prompt for a programmer. If you receive feedback from the Supervisor, refine the specification accordingly. Output ONLY the specification. No conversational preamble. No markdown formatting.',
  coder: 'You are the Coder agent in the Triforce system. Your job is to write valid, executable JavaScript code based on the specification provided. If you receive feedback/errors from the Supervisor/Sandbox, update the code to fix the issues. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  supervisorPromptCheck: 'You are the Supervisor agent in the Triforce system. Your job is to review a coding specification designed by another agent. Decide if it is ready for the coder (Greenlight) or needs refinement (Fix). If it needs refinement, provide specific feedback. Output your verdict in this exact format:\nVERDICT: [GREENLIGHT or FIX]\nFEEDBACK: [Your feedback if verdict is FIX]',
  supervisorCodeCheck: 'You are the Supervisor agent in the Triforce system. You receive the coder\'s Javascript code and the terminal output from executing it in a sandbox. Analyze both and produce a clear Pass/Fail verdict. If it works, output \'VERDICT: PASS\'. If it fails, output \'VERDICT: FAIL\' and specify what needs to be fixed. Output format:\nVERDICT: [PASS or FAIL]\nFEEDBACK: [Your feedback if verdict is FAIL]'
};

const SYSTEM_PROMPTS_WORKSPACE = {
  coder: 'You are the Workspace Coder in Triforce. Build the requested multi-file project. Return ONLY one valid JSON object with this shape: {"files":[{"path":"relative/path","content":"complete file contents"}],"testFile":"test.js"}. Include every required source, asset, package manifest, and automated test as text. Paths must be relative and may not contain .., .git, or node_modules. The testFile must be runnable with Node, must import and exercise the application in-process, and must not spawn child processes. Do not use markdown fences or add prose outside the JSON.',
  reviewer: 'You are the Workspace Reviewer in Triforce. Review the requested task, architecture plan, generated file manifest, and isolated test output. Return exactly VERDICT: PASS or VERDICT: FAIL followed by FEEDBACK: with concise, actionable details. PASS only when the generated project satisfies the task and its tests exited successfully.',
};

function stripCodeFences(text) {
  return text
    .replace(/^```(?:javascript|js)?\n?/gm, '')
    .replace(/^```\n?/gm, '')
    .trim();
}

// Spawn code in a subprocess and stream stdout/stderr back over ws as pty events.
function runInSandbox(code, ws, timeoutMs = 10000) {
  return runSandboxed(code, { timeoutMs, onOutput: (text, kind) => {
    const data = kind === 'stderr' ? `\x1b[31m${text}\x1b[0m` : text;
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pty', role: 'developer', data }));
  }});
}

function computeCosts(records) {
  return records.map(({ role, model, inputTokens, outputTokens }) => {
    const [inRate, outRate] = RATES[model] ?? [0, 0];
    const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
    return { role, model, inputTokens, outputTokens, cost };
  });
}

let latestUsage = {
  architect: { inputTokens: 0, outputTokens: 0, cost: 0 },
  developer: { inputTokens: 0, outputTokens: 0, cost: 0 },
  reviewer:  { inputTokens: 0, outputTokens: 0, cost: 0 },
};

/**
 * Executes the Triforce multi-agent pipeline.
 * Supports two modes:
 * Mode 1 (Sequential Handoff): Run standard sequence (Architect -> Developer -> Sandbox -> Reviewer)
 *        with full task/plan context passed forward (piggybacking) to save costs and reduce reasoning gaps.
 * Mode 2 (Cooperative Loop): Run a prompt designer specification loop and coder loop, where the
 *        Supervisor checks the specification/code and requests corrections in up to 3 iterative loops.
 */
async function runPipeline(ws, task, config, mode = 1) {
  if (typeof task !== 'string' || !task.trim() || task.length > 50000) throw new Error('Task must be 1-50000 characters');
  if (!config || typeof config !== 'object') throw new Error('Invalid pipeline configuration');
  const maxIterations = Math.min(10, Math.max(1, Number.parseInt(config.maxIterations ?? 3, 10) || 3));
  for (const role of ['architect', 'developer', 'reviewer']) {
    if (!config[role] || typeof config[role].provider !== 'string' || typeof config[role].model !== 'string') throw new Error(`Invalid ${role} configuration`);
    if (!ALLOWED_MODELS.get(config[role].provider)?.has(config[role].model)) throw new Error(`Unsupported ${role} provider/model`);
  }
  mode = [2, 3].includes(mode) ? mode : 1;
  const send = (data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
  try {
    const records = [];
    let pipelinePassed = true;
    const transcriptDir = process.env.TRIFORCE_TRANSCRIPTS === '1'
      ? join(TRANSCRIPTS_DIR, `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(6).toString('hex')}`)
      : null;
    if (transcriptDir) await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
    const logTranscript = (role, text) => transcriptDir
      ? appendFile(join(transcriptDir, `${role}.log`), text, { encoding: 'utf8', mode: 0o600 })
      : Promise.resolve();

  const sessionUsage = {
    architect: { inputTokens: 0, outputTokens: 0, cost: 0 },
    developer: { inputTokens: 0, outputTokens: 0, cost: 0 },
    reviewer:  { inputTokens: 0, outputTokens: 0, cost: 0 },
  };

  // Per-run transcript buffers (for cross-agent context)
  const runLog = { architect: '', developer: '', reviewer: '' };
  const runHeader = `\n${'─'.repeat(60)}\n[${new Date().toISOString()}] ${task}\n${'─'.repeat(60)}\n`;

  const track = (role, model, usage) => {
    records.push({ role, model, ...usage });
    const [inRate, outRate] = RATES[model] ?? [0, 0];
    const itemCost = (usage.inputTokens / 1e6) * inRate + (usage.outputTokens / 1e6) * outRate;
    sessionUsage[role] = {
      inputTokens:  sessionUsage[role].inputTokens + usage.inputTokens,
      outputTokens: sessionUsage[role].outputTokens + usage.outputTokens,
      cost:         sessionUsage[role].cost + itemCost,
    };
    send({ type: 'usage', usage: sessionUsage });
  };

  const startTime = Date.now();
  let completedWorkspaceDir = null;

  if (mode === 3) {
    send({ type: 'status', stage: 'architect', label: 'Stage 1: Workspace Architect' });
    const architect = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS.architect });
    const { text: plan, usage: planUsage } = await architect.call(task);
    track('architect', config.architect.model, planUsage);
    runLog.architect = plan;
    send({ type: 'output', role: 'architect', text: plan });
    await logTranscript('architect', runHeader + plan + '\n');

    const coder = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS_WORKSPACE.coder });
    const reviewer = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_WORKSPACE.reviewer });
    let coderPrompt = `TASK:\n${task}\n\nARCHITECTURE PLAN:\n${plan}`;
    let approved = false;

    for (let iteration = 1; iteration <= maxIterations && !approved; iteration++) {
      send({ type: 'status', stage: 'developer', label: `Stage 2: Workspace Coder (${iteration})` });
      const { text, usage } = await coder.call(coderPrompt);
      track('developer', config.developer.model, usage);
      runLog.developer = text;
      send({ type: 'output', role: 'developer', text });
      await logTranscript('developer', runHeader + `\n--- ITERATION ${iteration} ---\n` + text + '\n');

      let manifest, workspace, result;
      try {
        manifest = parseWorkspaceManifest(text);
        workspace = await createWorkspace(manifest, WORKSPACES_DIR, { dependencyRoot: join(__dirname, 'node_modules') });
        send({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files });
        send({ type: 'pty', role: 'developer', data: `\r\n\x1b[32m[Workspace] Wrote ${workspace.files.length} files to ${workspace.directory}\x1b[0m\r\n` });
        send({ type: 'status', stage: 'sandbox', label: `Stage 3: Workspace Tests (${iteration})` });
        result = await runWorkspaceTest(workspace, {
          packageRoot: __dirname,
          onOutput: (value, kind) => send({ type: 'pty', role: 'developer', data: kind === 'stderr' ? `\x1b[31m${value}\x1b[0m` : value }),
        });
      } catch (err) {
        result = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
      }
      send({ type: 'sandbox', ...result });

      const summary = [
        `Workspace: ${workspace?.directory ?? '(manifest rejected)'}`,
        `Files: ${workspace?.files.join(', ') ?? '(none)'}`,
        `Exit code: ${result.exitCode}`,
        result.timedOut ? 'Status: TIMED OUT' : '',
        result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n');
      send({ type: 'status', stage: 'reviewer', label: `Stage 4: Workspace Review (${iteration})` });
      const reviewPrompt = `TASK:\n${task}\n\nPLAN:\n${plan}\n\nGENERATED MANIFEST:\n${text}\n\nTEST RESULTS:\n${summary}`;
      const { text: review, usage: reviewUsage } = await reviewer.call(reviewPrompt);
      track('reviewer', config.reviewer.model, reviewUsage);
      runLog.reviewer += `\n--- ITERATION ${iteration} ---\n${review}\n`;
      send({ type: 'output', role: 'reviewer', text: runLog.reviewer });
      await logTranscript('reviewer', runHeader + runLog.reviewer);
      approved = /VERDICT:\s*PASS/i.test(review) && result.exitCode === 0 && !result.timedOut;
      if (approved) {
        pipelinePassed = true;
        completedWorkspaceDir = workspace.directory;
        send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[PASS] Project preserved at ${workspace.directory}\x1b[0m\r\n` });
      } else {
        const feedback = review.match(/FEEDBACK:\s*([\s\S]+)/i)?.[1]?.trim() || summary;
        coderPrompt = `TASK:\n${task}\n\nARCHITECTURE PLAN:\n${plan}\n\nPREVIOUS ATTEMPT RESULTS:\n${summary}\n\nREVIEWER FEEDBACK:\n${feedback}\n\nReturn a complete corrected workspace JSON manifest.`;
      }
    }
    if (!approved) {
      send({ type: 'error', stage: 'reviewer', message: `Failed to produce a passing workspace after ${maxIterations} iterations.` });
      return;
    }
  } else if (mode === 2) {
    // ── Mode 2 Cooperative Loop ──
    const designerAgent = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS_MODE2.designer });
    const coderAgent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS_MODE2.coder });
    const promptSupervisor = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_MODE2.supervisorPromptCheck });
    const codeSupervisor = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_MODE2.supervisorCodeCheck });

    let spec = '';
    let specApproved = false;

    // ── Stage 1 & 4 (Prompt Loop) ──
    send({ type: 'status', stage: 'architect', label: 'Stage 1: Prompt Designer' });
    let designerPrompt = `TASK:\n${task}`;
    let promptLoopCount = 0;

    while (promptLoopCount < maxIterations && !specApproved) {
      promptLoopCount++;
      const iterHeader = `\n--- ITERATION ${promptLoopCount} ---\n`;
      
      // Call Prompt Designer
      send({ type: 'pty', role: 'architect', data: `\r\n\x1b[35m[Iteration ${promptLoopCount}] Running Prompt Designer...\x1b[0m\r\n` });
      try {
        const { text, usage } = await designerAgent.call(designerPrompt);
        track('architect', config.architect.model, usage);
        spec = text;
        runLog.architect += iterHeader + text + '\n';
        send({ type: 'output', role: 'architect', text: runLog.architect });
        await logTranscript('architect', runHeader + iterHeader + text + '\n');
      } catch (err) {
        send({ type: 'error', stage: 'architect', message: err.message });
        return;
      }

      // Call Supervisor for Prompt Check
      send({ type: 'status', stage: 'reviewer', label: `Stage 4: Supervisor (Prompt Check ${promptLoopCount})` });
      send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[35m[Iteration ${promptLoopCount}] Running Supervisor (Prompt Check)...\x1b[0m\r\n` });
      
      let supervisorResult;
      try {
        const { text, usage } = await promptSupervisor.call(`SPECIFICATION TO REVIEW:\n${spec}`);
        track('reviewer', config.reviewer.model, usage);
        supervisorResult = text;
        runLog.reviewer += iterHeader + '[Prompt Check]\n' + text + '\n';
        send({ type: 'output', role: 'reviewer', text: runLog.reviewer });
        await logTranscript('reviewer', runHeader + iterHeader + '[Prompt Check]\n' + text + '\n');
      } catch (err) {
        send({ type: 'error', stage: 'reviewer', message: err.message });
        return;
      }

      // Parse verdict
      const verdictMatch = supervisorResult.match(/VERDICT:\s*(\w+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FIX';
      if (verdict === 'GREENLIGHT') {
        specApproved = true;
        send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[GREENLIGHT] Specification approved by Supervisor.\x1b[0m\r\n` });
      } else {
        const feedbackMatch = supervisorResult.match(/FEEDBACK:\s*([\s\S]+)/i);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'Please refine the specification.';
        send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[FIX] Supervisor requested refinement.\x1b[0m\r\n` });
        
        // Update Prompt Designer's next prompt with feedback
        designerPrompt = `SPECIFICATION GENERATED:\n${spec}\n\nSUPERVISOR FEEDBACK:\n${feedback}\n\nPlease update the specification to address this feedback.`;
        // Set state back to architect
        send({ type: 'status', stage: 'architect', label: `Stage 1: Prompt Designer (Iteration ${promptLoopCount + 1})` });
      }
    }

    if (!specApproved) {
      send({ type: 'error', stage: 'architect', message: `Failed to design a specification acceptable to the Supervisor after ${maxIterations} iterations.` });
      return;
    }

    // ── Stage 2 & 4 (Code Loop) ──
    let codeApproved = false;
    let codeLoopCount = 0;
    let coderPrompt = `SPECIFICATION:\n${spec}`;
    let code = '';

    while (codeLoopCount < maxIterations && !codeApproved) {
      codeLoopCount++;
      const iterHeader = `\n--- ITERATION ${codeLoopCount} ---\n`;

      // Call Coder (Developer)
      send({ type: 'status', stage: 'developer', label: `Stage 2: Coder (Iteration ${codeLoopCount})` });
      send({ type: 'pty', role: 'developer', data: `\r\n\x1b[35m[Iteration ${codeLoopCount}] Running Coder...\x1b[0m\r\n` });
      try {
        const { text, usage } = await coderAgent.call(coderPrompt);
        track('developer', config.developer.model, usage);
        code = stripCodeFences(text);
        runLog.developer += iterHeader + code + '\n';
        send({ type: 'output', role: 'developer', text: runLog.developer });
        await logTranscript('developer', runHeader + iterHeader + code + '\n');
      } catch (err) {
        send({ type: 'error', stage: 'developer', message: err.message });
        return;
      }

      // Run Sandbox
      send({ type: 'status', stage: 'sandbox', label: 'Stage 3: Sandbox' });
      let sandboxResult;
      try {
        sandboxResult = await runInSandbox(code, ws);
        const sandboxLog = `\n// EXIT: ${sandboxResult.exitCode}${sandboxResult.timedOut ? ' (TIMED OUT)' : ''}\n// stdout:\n${sandboxResult.stdout}`;
        await logTranscript('developer', sandboxLog);
      } catch (err) {
        sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
      }
      send({ type: 'sandbox', ...sandboxResult });

      // Call Supervisor for Code Check
      send({ type: 'status', stage: 'reviewer', label: `Stage 4: Supervisor (Code Check ${codeLoopCount})` });
      send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[35m[Iteration ${codeLoopCount}] Running Supervisor (Code Check)...\x1b[0m\r\n` });

      const executionSummary = [
        `Exit code: ${sandboxResult.exitCode ?? 0}`,
        sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
        sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
        sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
      ].filter(Boolean).join('\n');

      let supervisorResult;
      try {
        const prompt = `SPECIFICATION:\n${spec}\n\nCODE GENERATED:\n${code}\n\nSANDBOX RUN RESULTS:\n${executionSummary}`;
        const { text, usage } = await codeSupervisor.call(prompt);
        track('reviewer', config.reviewer.model, usage);
        supervisorResult = text;
        runLog.reviewer += iterHeader + '[Code Check]\n' + text + '\n';
        send({ type: 'output', role: 'reviewer', text: runLog.reviewer });
        await logTranscript('reviewer', runHeader + iterHeader + '[Code Check]\n' + text + '\n');
      } catch (err) {
        send({ type: 'error', stage: 'reviewer', message: err.message });
        return;
      }

      // Parse verdict
      const verdictMatch = supervisorResult.match(/VERDICT:\s*(\w+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FAIL';
      if (verdict === 'PASS' && sandboxResult.exitCode === 0 && !sandboxResult.timedOut) {
        codeApproved = true;
        send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[PASS] Code approved by Supervisor.\x1b[0m\r\n` });
      } else {
        const feedbackMatch = supervisorResult.match(/FEEDBACK:\s*([\s\S]+)/i);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'Please fix the code.';
        send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[FAIL] Supervisor flagged code issues.\x1b[0m\r\n` });

        // Update Coder's prompt with feedback and sandbox results
        coderPrompt = `PREVIOUS CODE:\n${code}\n\nSANDBOX RUN RESULTS:\n${executionSummary}\n\nSUPERVISOR FEEDBACK:\n${feedback}\n\nPlease update the code to fix these issues. Output ONLY the updated Javascript code, no comments or markdown.`;
      }
    }

    if (!codeApproved) {
      send({ type: 'error', stage: 'reviewer', message: `Failed to write code that passes Supervisor checks after ${maxIterations} iterations.` });
      return;
    }

  } else {
    // ── Mode 1: Sequential Pipeline (with full context handoff / piggybacking) ──
    // ── Stage 1: Claude Code ──
    send({ type: 'status', stage: 'architect', label: 'Stage 1: Claude Code' });
    let plan;
    try {
      const agent = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS.architect });
      const { text, usage } = await agent.call(task);
      track('architect', config.architect.model, usage);
      plan = text;
      runLog.architect = text;
      send({ type: 'output', role: 'architect', text });
      await logTranscript('architect', runHeader + text + '\n');
    } catch (err) {
      send({ type: 'error', stage: 'architect', message: err.message });
      return;
    }

    // ── Stage 2: Codex (receives task + plan as context) ──
    send({ type: 'status', stage: 'developer', label: 'Stage 2: Codex' });
    let code;
    try {
      const agent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS.developer });
      const prompt = `TASK:\n${task}\n\nPLAN:\n${plan}`;
      const { text, usage } = await agent.call(prompt);
      track('developer', config.developer.model, usage);
      code = stripCodeFences(text);
      runLog.developer = code;
      send({ type: 'output', role: 'developer', text: code });
      await logTranscript('developer', runHeader + code + '\n');
    } catch (err) {
      send({ type: 'error', stage: 'developer', message: err.message });
      return;
    }

    // ── Stage 3: Sandbox (streaming output via pty events) ──
    send({ type: 'status', stage: 'sandbox', label: 'Stage 3: Sandbox' });
    let sandboxResult;
    try {
      sandboxResult = await runInSandbox(code, ws);
      const sandboxLog = `\n// EXIT: ${sandboxResult.exitCode}${sandboxResult.timedOut ? ' (TIMED OUT)' : ''}\n// stdout:\n${sandboxResult.stdout}`;
      await logTranscript('developer', sandboxLog);
    } catch (err) {
      sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
    }
    send({ type: 'sandbox', ...sandboxResult });

    // ── Stage 4: Antigravity (receives task + plan + code + execution results) ──
    send({ type: 'status', stage: 'reviewer', label: 'Stage 4: Antigravity' });
    try {
      const executionSummary = [
        `Exit code: ${sandboxResult.exitCode ?? 0}`,
        sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
        sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
        sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
      ].filter(Boolean).join('\n');

      const prompt = `TASK:\n${task}\n\nARCHITECT PLAN:\n${runLog.architect}\n\nCODE:\n${runLog.developer}\n\nEXECUTION RESULTS:\n${executionSummary}`;
      const agent = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS.reviewer });
      const { text, usage } = await agent.call(prompt);
      track('reviewer', config.reviewer.model, usage);
      runLog.reviewer = text;
      pipelinePassed = sandboxResult.exitCode === 0 && !sandboxResult.timedOut && !/\bFAIL\b/i.test(text);
      send({ type: 'output', role: 'reviewer', text });
      await logTranscript('reviewer', runHeader + text + '\n');
    } catch (err) {
      send({ type: 'error', stage: 'reviewer', message: err.message });
      return;
    }
  }

  // Run graphify update . to keep the graph current
  try {
    const child = spawn('graphify', ['update', '.'], { stdio: 'ignore', cwd: completedWorkspaceDir || __dirname });
    await Promise.race([
      new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); }),
      new Promise((_, reject) => setTimeout(() => { child.kill('SIGKILL'); reject(new Error('graphify update timed out')); }, 30000)),
    ]);
    send({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[Graphify] Codebase knowledge graph updated successfully.\x1b[0m\r\n` });
  } catch (err) {
    // Fail silently if not installed
  }

  const costRecords = computeCosts(records);
  const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
  latestUsage = structuredClone(sessionUsage);
  send({ type: 'cost', records: costRecords, total });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  send({ type: 'done', elapsed, passed: pipelinePassed });
  } catch (err) {
    send({ type: 'error', stage: 'architect', message: err.message });
  }
}

// ── EXPRESS + HTTP SERVER ──
const app = express();
app.use(express.json());

function tokenMatches(value) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(AUTH_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(req) {
  return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('triforce_token='))?.slice('triforce_token='.length);
}

function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `triforce_token=${AUTH_TOKEN}; HttpOnly; SameSite=Strict; Path=/${secure}`);
}

app.get('/auth', (req, res) => {
  if (!tokenMatches(req.query.token)) return res.status(401).send('Invalid token');
  setSessionCookie(req, res);
  res.redirect('/');
});

app.post('/api/session', (req, res) => {
  if (!tokenMatches(req.body?.token)) return res.status(401).json({ error: 'invalid credentials' });
  setSessionCookie(req, res);
  res.status(204).end();
});

app.delete('/api/session', (_req, res) => {
  res.setHeader('Set-Cookie', 'triforce_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.status(204).end();
});

app.use('/api', (req, res, next) => tokenMatches(cookieToken(req)) ? next() : res.status(401).json({ error: 'unauthorized' }));

// PWA-critical headers
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile('sw.js', { root: join(__dirname, 'public') });
});
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile('manifest.json', { root: join(__dirname, 'public') });
});

app.use('/icons', express.static(join(__dirname, 'public/icons')));
app.use(express.static(join(__dirname, 'public')));

app.get('/api/usage', (req, res) => {
  const total = Object.values(latestUsage).reduce(
    (acc, r) => ({
      inputTokens:  acc.inputTokens  + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cost: acc.cost + r.cost,
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  );
  res.json({ ...latestUsage, total });
});

app.get('/api/config', async (req, res) => {
  try {
    const raw = await readFile(join(__dirname, 'models.config.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/capabilities', (_req, res) => res.json(capabilities));
app.get('/api/runs', (_req, res) => res.json({ runs: runRegistry.list() }));
app.get('/api/runs/:runId', (req, res) => {
  const run = runRegistry.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json({ run: runRegistry.snapshot(run) });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const expectedOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  if (!tokenMatches(cookieToken(req)) || (origin && origin !== expectedOrigin)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const unsubscribe = new Set();
  ws.on('close', () => {
    for (const remove of unsubscribe) remove();
    unsubscribe.clear();
  });
  ws.on('message', async (raw) => {
    if (raw.length > 1024 * 1024) return ws.close(1009, 'Message too large');
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!['run', 'subscribe', 'capabilities'].includes(msg.type)) return;
    const parsed = validateClientCommand(msg);
    if (!parsed.success) {
      return ws.send(JSON.stringify({ type: 'protocol_error', code: 'INVALID_COMMAND', message: parsed.error.issues[0]?.message || 'Invalid command' }));
    }
    const command = parsed.data;
    if (command.protocolVersion && !isCompatibleProtocol(command.protocolVersion)) {
      return ws.send(JSON.stringify({ type: 'protocol_error', code: 'INCOMPATIBLE_VERSION', message: `Server requires protocol major ${capabilities.protocolMajor}`, capabilities }));
    }
    if (command.type === 'capabilities') {
      return ws.send(JSON.stringify({ type: 'capabilities', capabilities }));
    }
    if (command.type === 'subscribe') {
      const run = runRegistry.get(command.runId);
      if (!run) return ws.send(JSON.stringify({ type: 'protocol_error', code: 'RUN_NOT_FOUND', message: 'Run not found' }));
      unsubscribe.add(runRegistry.subscribe(run, ws, command.afterEventId));
      return;
    }
    if (command.type === 'run') {
      try {
        const run = runRegistry.start(command, pipelineSocket => runPipeline(pipelineSocket, command.task, command.config, command.mode));
        ws.send(JSON.stringify({ type: 'run_started', run: runRegistry.snapshot(run) }));
        unsubscribe.add(runRegistry.subscribe(run, ws));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', stage: 'architect', message: err.message }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Triforce server running on http://localhost:${PORT}`));
