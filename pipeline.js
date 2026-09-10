import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Agent } from './agent.js';
import { runSandboxed } from './sandbox.js';
import { getRates } from './models.js';
import { createWorkspace, createWorkspaceFromDir, parseWorkspaceManifest, runWorkspaceTest, getWorkspaceDiff, gcWorkspaces } from './workspace.js';
import { track } from './usage.js';
import { normalizePipelineConfig } from './packages/protocol/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SYSTEM_PROMPTS = {
  architect: 'You are the Architect agent in the Triforce system. Your job is to analyze a coding task and produce a clear, structured implementation plan. Output ONLY the plan as numbered steps. No code. No markdown formatting. No preamble.',
  developer: 'You are the Developer agent in the Triforce system. You receive an implementation plan and your job is to write the code. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  reviewer:  'You are the Reviewer agent in the Triforce system. You receive code written by another agent and the terminal output from executing that code. Analyze both and produce a clear Pass/Fail verdict. If Pass: confirm what worked. If Fail: identify exactly what went wrong and what should be fixed. Be concise and specific.',
};

export const SYSTEM_PROMPTS_MODE2 = {
  designer: 'You are the Prompt Designer agent in the Triforce system. Your job is to analyze a coding task and produce a clear, detailed specification/prompt for a programmer. If you receive feedback from the Supervisor, refine the specification accordingly. Output ONLY the specification. No conversational preamble. No markdown formatting.',
  coder: 'You are the Coder agent in the Triforce system. Your job is to write valid, executable JavaScript code based on the specification provided. If you receive feedback/errors from the Supervisor/Sandbox, update the code to fix the issues. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  supervisorPromptCheck: 'You are the Supervisor agent in the Triforce system. Your job is to review a coding specification designed by another agent. Decide if it is ready for the coder (Greenlight) or needs refinement (Fix). If it needs refinement, provide specific feedback. Output your verdict in this exact format:\nVERDICT: [GREENLIGHT or FIX]\nFEEDBACK: [Your feedback if verdict is FIX]',
  supervisorCodeCheck: 'You are the Supervisor agent in the Triforce system. You receive the coder\'s Javascript code and the terminal output from executing it in a sandbox. Analyze both and produce a clear Pass/Fail verdict. If it works, output \'VERDICT: PASS\'. If it fails, output \'VERDICT: FAIL\' and specify what needs to be fixed. Output format:\nVERDICT: [PASS or FAIL]\nFEEDBACK: [Your feedback if verdict is FAIL]'
};

export const SYSTEM_PROMPTS_WORKSPACE = {
  coder: 'You are the Workspace Coder in Triforce. Build the requested multi-file project. Return ONLY one valid JSON object with this shape: {"files":[{"path":"relative/path","content":"complete file contents"}],"testFile":"test.js"}. Include every required source, asset, package manifest, and automated test as text. Paths must be relative and may not contain .., .git, or node_modules. The testFile must be runnable with Node, must import and exercise the application in-process, and must not spawn child processes. Do not use markdown fences or add prose outside the JSON.',
  reviewer: 'You are the Workspace Reviewer in Triforce. Review the requested task, architecture plan, generated file manifest, and isolated test output. Return exactly VERDICT: PASS or VERDICT: FAIL followed by FEEDBACK: with concise, actionable details. PASS only when the generated project satisfies the task and its tests exited successfully.',
};

// Mode 1 — structured build. Prompt Designer → Supervisor → Coder → Supervisor,
// every review anchored to the verbatim original human prompt.
export const SYSTEM_PROMPTS_BUILD = {
  promptDesigner: 'You are the Prompt Designer in the Triforce structured-build loop. Turn the ORIGINAL HUMAN PROMPT into a precise implementation spec for a programmer: goals, concrete changes, file-level plan, and the acceptance test. Stay strictly within the scope of the original prompt — do not add features it did not ask for. If the Supervisor requests changes, revise accordingly. Output ONLY the spec, no preamble, no markdown fences.',
  supervisorPromptCheck: 'You are the Supervisor reviewing an implementation spec AGAINST the verbatim ORIGINAL HUMAN PROMPT. Judge only: is it in scope, complete, and unambiguous? Output exactly:\nVERDICT: [APPROVE or REVISE]\nFEEDBACK: [specifics if REVISE]',
  coder: 'You are the Coder in the Triforce structured-build loop. Implement the APPROVED SPEC by returning ONLY one valid JSON object: {"files":[{"path":"relative/path","content":"complete file contents"}],"testFile":"path/to/test.js"}. When editing an existing project, return every file you change or add with its full new contents; unlisted files are left untouched. Paths are relative and may not contain .., .git, or node_modules. The testFile must run under Node in-process and must not spawn child processes. No markdown fences, no prose outside the JSON.',
  supervisorCodeCheck: 'You are the Supervisor reviewing generated code AGAINST the verbatim ORIGINAL HUMAN PROMPT and the APPROVED SPEC, given the file manifest, the isolated test output, and the diff. Output exactly:\nVERDICT: [PASS or FAIL]\nFEEDBACK: [specific required fixes if FAIL]\nPASS only when the change satisfies the original prompt and its tests exited successfully.',
};



export function stripCodeFences(text) {
  if (typeof text !== 'string') return '';
  let cleaned = text.trim();
  
  const leadingFence = /^\s*```(?:javascript|js|json)?\s*\n/i;
  const leadingMatch = cleaned.match(leadingFence);
  if (leadingMatch) {
    cleaned = cleaned.substring(leadingMatch[0].length);
  }
  
  const trailingFence = /\n\s*```\s*$/;
  const trailingMatch = cleaned.match(trailingFence);
  if (trailingMatch) {
    cleaned = cleaned.substring(0, cleaned.length - trailingMatch[0].length);
  }
  
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.slice(3, -3).trim();
  }

  return cleaned.trim();
}

export function parseVerdict(text, allowedSet) {
  if (typeof text !== 'string') {
    return { verdict: null, feedback: '', parsed: false };
  }

  const verdictRegex = /(?:[\[\*_]+VERDICT[\]\*_]+\s*(?::|=|\bis\b)?\s*[\[\*_]*([a-zA-Z]+)[\]\*_]*|[\[\*_]*VERDICT[\]\*_]*\s*(?::|=|\bis\b)\s*[\[\*_]*([a-zA-Z]+)[\]\*_]*)/i;
  const match = text.match(verdictRegex);
  if (!match) {
    return { verdict: null, feedback: '', parsed: false };
  }

  const verdict = (match[1] || match[2]).toUpperCase();
  
  if (allowedSet && !allowedSet.has(verdict)) {
    return { verdict: null, feedback: '', parsed: false };
  }

  const feedbackRegex = /(?:[\[\*_]*FEEDBACK[\]\*_]*\s*(?::|=|\bis\b)?\s*([\s\S]*))/i;
  const feedbackMatch = text.match(feedbackRegex);
  
  let feedback = '';
  if (feedbackMatch) {
    feedback = feedbackMatch[1].trim();
    if (feedback.startsWith('**') && feedback.endsWith('**')) {
      feedback = feedback.slice(2, -2).trim();
    } else if (feedback.startsWith('*') && feedback.endsWith('*')) {
      feedback = feedback.slice(1, -1).trim();
    } else if (feedback.startsWith('[') && feedback.endsWith(']')) {
      feedback = feedback.slice(1, -1).trim();
    }
  }

  return { verdict, feedback, parsed: true };
}

export async function executePipeline(task, config, mode = 1, options = {}, onEvent = () => {}) {
  const {
    workspacesDir,
    packageRoot = __dirname,
    dependencyRoot,
    workingDir,
    seededWorkspace,
    signal,
  } = options;

  const checkAbort = () => {
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
  };

  const maxIterations = Math.min(10, Math.max(1, Number.parseInt(config.maxIterations ?? 3, 10) || 3));

  const records = [];
  const sessionUsage = {
    architect: { inputTokens: 0, outputTokens: 0, cost: 0 },
    developer: { inputTokens: 0, outputTokens: 0, cost: 0 },
    reviewer:  { inputTokens: 0, outputTokens: 0, cost: 0 },
  };

  const trackUsage = (role, model, usage) => {
    records.push({ role, model, ...usage });
    track(role, model, usage); // update usage.js records
    const [inRate, outRate] = getRates(model);
    const itemCost = (usage.inputTokens / 1e6) * inRate + (usage.outputTokens / 1e6) * outRate;
    sessionUsage[role] = {
      inputTokens:  sessionUsage[role].inputTokens + usage.inputTokens,
      outputTokens: sessionUsage[role].outputTokens + usage.outputTokens,
      cost:         sessionUsage[role].cost + itemCost,
    };
    onEvent({ type: 'usage', usage: sessionUsage });
  };

  const runLog = { architect: '', developer: '', reviewer: '' };
  const runHeader = `\n${'─'.repeat(60)}\n[${new Date().toISOString()}] ${task}\n${'─'.repeat(60)}\n`;

  const transcriptDir = process.env.TRIFORCE_TRANSCRIPTS === '1'
    ? join(packageRoot, 'transcripts', `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(6).toString('hex')}`)
    : null;
  if (transcriptDir) {
    await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
  }
  const logTranscript = (role, text) => transcriptDir
    ? appendFile(join(transcriptDir, `${role}.log`), text, { encoding: 'utf8', mode: 0o600 })
    : Promise.resolve();

  let pipelinePassed = true;
  const startTime = Date.now();
  let completedWorkspaceDir = null;
  let activeWorkspaceDir = null;

  const collectOldWorkspaces = async () => {
    if (!workspacesDir) return;
    try {
      const { removed } = await gcWorkspaces(workspacesDir, { protect: activeWorkspaceDir ? [activeWorkspaceDir] : [] });
      if (removed.length) onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[33m[Workspace GC] Removed ${removed.length} old workspace(s).\x1b[0m\r\n` });
    } catch { /* retention must never fail the pipeline */ }
  };

  try {
    // ── Mode 1: structured build (Prompt Designer → Supervisor → Coder → Supervisor) ──
    const norm = normalizePipelineConfig(config);
    const designerCfg = norm.promptDesigner ?? norm.architect;
    const coderCfg = norm.coder ?? norm.developer;
    const supervisorCfg = norm.supervisor ?? norm.reviewer;
    for (const [label, c] of [['Prompt Designer', designerCfg], ['Coder', coderCfg], ['Supervisor', supervisorCfg]]) {
      if (!c?.provider || !c?.model) throw new Error(`Mode 1 requires a ${label} model`);
    }

    const designer = new Agent({ ...designerCfg, systemPrompt: SYSTEM_PROMPTS_BUILD.promptDesigner });
    const promptSupervisor = new Agent({ ...supervisorCfg, systemPrompt: SYSTEM_PROMPTS_BUILD.supervisorPromptCheck });
    const coder = new Agent({ ...coderCfg, systemPrompt: SYSTEM_PROMPTS_BUILD.coder });
    const codeSupervisor = new Agent({ ...supervisorCfg, systemPrompt: SYSTEM_PROMPTS_BUILD.supervisorCodeCheck });

    const maxPromptIterations = Math.min(10, Math.max(1, Number.parseInt(config.maxPromptIterations ?? maxIterations, 10) || maxIterations));
    const maxCodeIterations = Math.min(10, Math.max(1, Number.parseInt(config.maxCodeIterations ?? maxIterations, 10) || maxIterations));
    const ORIGINAL = `ORIGINAL HUMAN PROMPT (defines scope — never exceed it):\n${task}`;

    // Stage A — design the implementation spec, reviewed against the original prompt.
    let spec = '';
    let specApproved = false;
    let designerPrompt = `${ORIGINAL}\n\nProduce the implementation spec.`;
    for (let i = 1; i <= maxPromptIterations && !specApproved; i++) {
      checkAbort();
      onEvent({ type: 'status', stage: 'architect', label: `Prompt Designer (${i})` });
      const { text, usage } = await designer.call(designerPrompt, signal);
      trackUsage('architect', designerCfg.model, usage);
      spec = text;
      runLog.architect += `\n--- ITERATION ${i} ---\n${text}\n`;
      onEvent({ type: 'output', role: 'architect', text: spec, iteration: i });
      await logTranscript('architect', runHeader + spec + '\n');

      checkAbort();
      onEvent({ type: 'status', stage: 'reviewer', label: `Supervisor · prompt check (${i})` });
      const { text: review, usage: rUsage } = await promptSupervisor.call(`${ORIGINAL}\n\nPROPOSED IMPLEMENTATION SPEC:\n${spec}`, signal);
      trackUsage('reviewer', supervisorCfg.model, rUsage);
      runLog.reviewer += `\n--- ITERATION ${i} · prompt check ---\n${review}\n`;
      onEvent({ type: 'output', role: 'reviewer', text: review, iteration: i, label: 'Prompt Check' });
      await logTranscript('reviewer', runHeader + runLog.reviewer);
      const parsed = parseVerdict(review, new Set(['APPROVE', 'REVISE', 'GREENLIGHT', 'FIX']));
      if (!parsed.parsed) onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[Parse Warning] prompt-check verdict unclear\x1b[0m\r\n` });
      const verdict = parsed.verdict || 'REVISE';
      if (verdict === 'APPROVE' || verdict === 'GREENLIGHT') {
        specApproved = true;
        onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[APPROVE] Spec approved.\x1b[0m\r\n` });
      } else {
        designerPrompt = `${ORIGINAL}\n\nCURRENT SPEC:\n${spec}\n\nSUPERVISOR REQUESTED CHANGES:\n${parsed.feedback || 'Tighten scope and remove ambiguity.'}\n\nReturn the revised spec.`;
      }
    }
    if (!specApproved) throw new Error(`Supervisor did not approve an implementation spec within ${maxPromptIterations} iterations.`);

    // Stage B — build in a workspace copy of the selected folder (if any), test, review.
    let workspace = null;
    if (seededWorkspace) {
      workspace = seededWorkspace;
      activeWorkspaceDir = workspace.directory;
      onEvent({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files, source: workingDir });
    } else if (workingDir) {
      checkAbort();
      onEvent({ type: 'status', stage: 'developer', label: 'Seeding workspace from selected folder' });
      const seeded = await createWorkspaceFromDir(workingDir, workspacesDir, { dependencyRoot });
      workspace = { id: seeded.id, directory: seeded.directory, testFile: seeded.testFile, files: seeded.files };
      activeWorkspaceDir = workspace.directory;
      onEvent({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files, source: seeded.sourceDir });
    }

    let coderPrompt = `${ORIGINAL}\n\nAPPROVED SPEC:\n${spec}\n\n${workingDir ? 'You are editing an existing project already present in the workspace.' : 'Create the project from scratch.'} Return the full workspace JSON manifest.`;
    let approved = false;
    for (let i = 1; i <= maxCodeIterations && !approved; i++) {
      checkAbort();
      onEvent({ type: 'status', stage: 'developer', label: `Coder (${i})` });
      const { text, usage } = await coder.call(coderPrompt, signal);
      trackUsage('developer', coderCfg.model, usage);
      runLog.developer = text;
      onEvent({ type: 'output', role: 'developer', text, iteration: i });
      await logTranscript('developer', runHeader + `\n--- ITERATION ${i} ---\n` + text + '\n');

      let result;
      try {
        const manifest = parseWorkspaceManifest(text);
        workspace = await createWorkspace(manifest, workspacesDir, { dependencyRoot, existingWorkspace: workspace, iteration: i });
        activeWorkspaceDir = workspace.directory;
        onEvent({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files });
        onEvent({ type: 'status', stage: 'sandbox', label: `Workspace tests (${i})` });
        checkAbort();
        result = await runWorkspaceTest(workspace, {
          packageRoot,
          onOutput: (value, kind) => onEvent({ type: 'pty', role: 'developer', data: kind === 'stderr' ? `\x1b[31m${value}\x1b[0m` : value }),
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        result = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
      }
      checkAbort();
      onEvent({ type: 'sandbox', ...result });

      const diffText = await getWorkspaceDiff(workspace).catch(() => '');
      if (diffText) {
        onEvent({ type: 'diff', iteration: i, diff: diffText.length > 40960 ? diffText.slice(0, 40960) + '\n… [diff truncated] …' : diffText });
      }

      const summary = [
        `Files: ${workspace?.files.join(', ') ?? '(none)'}`,
        `Exit code: ${result.exitCode}`,
        result.timedOut ? 'Status: TIMED OUT' : '',
        result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n');

      onEvent({ type: 'status', stage: 'reviewer', label: `Supervisor · code check (${i})` });
      const reviewPrompt = `${ORIGINAL}\n\nAPPROVED SPEC:\n${spec}\n\nGENERATED MANIFEST:\n${runLog.developer}\n\nTEST RESULTS:\n${summary}${diffText ? `\n\nDIFF:\n\`\`\`diff\n${diffText.slice(0, 20480)}\n\`\`\`` : ''}`;
      const { text: review, usage: rUsage } = await codeSupervisor.call(reviewPrompt, signal);
      trackUsage('reviewer', supervisorCfg.model, rUsage);
      runLog.reviewer += `\n--- ITERATION ${i} · code check ---\n${review}\n`;
      onEvent({ type: 'output', role: 'reviewer', text: review, iteration: i, label: 'Code Check' });
      await logTranscript('reviewer', runHeader + runLog.reviewer);
      const parsed = parseVerdict(review, new Set(['PASS', 'FAIL', 'FIX']));
      if (!parsed.parsed) onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[Parse Warning] code-check verdict unclear\x1b[0m\r\n` });
      approved = parsed.verdict === 'PASS' && result.exitCode === 0 && !result.timedOut;
      if (approved) {
        pipelinePassed = true;
        completedWorkspaceDir = workspace.directory;
        onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[PASS] Build approved at ${workspace.directory}\x1b[0m\r\n` });
      } else {
        pipelinePassed = false;
        coderPrompt = `${ORIGINAL}\n\nAPPROVED SPEC:\n${spec}\n\nPREVIOUS TEST RESULTS:\n${summary}\n\nSUPERVISOR FEEDBACK:\n${parsed.feedback || summary}\n\nReturn a complete corrected workspace JSON manifest.`;
      }
    }
    if (!approved) throw new Error(`Build did not pass Supervisor review within ${maxCodeIterations} iterations.`);

    // Run graphify update . to keep the graph current
    try {
      const child = spawn('graphify', ['update', '.'], { stdio: 'ignore', cwd: completedWorkspaceDir || packageRoot });
      await Promise.race([
        new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); }),
        new Promise((_, reject) => setTimeout(() => { child.kill('SIGKILL'); reject(new Error('graphify update timed out')); }, 30000)),
      ]);
      onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[Graphify] Codebase knowledge graph updated successfully.\x1b[0m\r\n` });
    } catch (err) {
      // Fail silently if not installed
    }

    const costRecords = records.map(({ role, model, inputTokens, outputTokens, usageUnknown }) => {
      const [inRate, outRate] = getRates(model);
      const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
      return { role, model, inputTokens, outputTokens, cost, ...(usageUnknown ? { usageUnknown: true } : {}) };
    });
    const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
    onEvent({ type: 'cost', records: costRecords, total });

    await collectOldWorkspaces();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    onEvent({ type: 'done', elapsed, passed: pipelinePassed, completedWorkspaceDir });

  } catch (err) {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', stage: 'architect', message: err.message });
    }
    
    const costRecords = records.map(({ role, model, inputTokens, outputTokens, usageUnknown }) => {
      const [inRate, outRate] = getRates(model);
      const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
      return { role, model, inputTokens, outputTokens, cost, ...(usageUnknown ? { usageUnknown: true } : {}) };
    });
    const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
    onEvent({ type: 'cost', records: costRecords, total });
    await collectOldWorkspaces();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    onEvent({ type: 'done', elapsed, passed: false });
    throw err;
  }
}
