import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Agent } from './agent.js';
import { runSandboxed } from './sandbox.js';
import { getRates } from './models.js';
import { createWorkspace, parseWorkspaceManifest, runWorkspaceTest } from './workspace.js';
import { track } from './usage.js';

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

  try {
    if (mode === 3) {
      checkAbort();
      onEvent({ type: 'status', stage: 'architect', label: 'Stage 1: Workspace Architect' });
      const architect = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS.architect });
      const { text: plan, usage: planUsage } = await architect.call(task, signal);
      trackUsage('architect', config.architect.model, planUsage);
      runLog.architect = plan;
      onEvent({ type: 'output', role: 'architect', text: plan, iteration: 1 });
      await logTranscript('architect', runHeader + plan + '\n');

      const coder = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS_WORKSPACE.coder });
      const reviewer = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_WORKSPACE.reviewer });
      let coderPrompt = `TASK:\n${task}\n\nARCHITECTURE PLAN:\n${plan}`;
      let approved = false;

      for (let iteration = 1; iteration <= maxIterations && !approved; iteration++) {
        checkAbort();
        onEvent({ type: 'status', stage: 'developer', label: `Stage 2: Workspace Coder (${iteration})` });
        const { text, usage } = await coder.call(coderPrompt, signal);
        trackUsage('developer', config.developer.model, usage);
        runLog.developer = text;
        onEvent({ type: 'output', role: 'developer', text, iteration });
        await logTranscript('developer', runHeader + `\n--- ITERATION ${iteration} ---\n` + text + '\n');

        let manifest, workspace, result;
        try {
          manifest = parseWorkspaceManifest(text);
          workspace = await createWorkspace(manifest, workspacesDir, { dependencyRoot });
          onEvent({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files });
          onEvent({ type: 'pty', role: 'developer', data: `\r\n\x1b[32m[Workspace] Wrote ${workspace.files.length} files to ${workspace.directory}\x1b[0m\r\n` });
          onEvent({ type: 'status', stage: 'sandbox', label: `Stage 3: Workspace Tests (${iteration})` });
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

        const summary = [
          `Workspace: ${workspace?.directory ?? '(manifest rejected)'}`,
          `Files: ${workspace?.files.join(', ') ?? '(none)'}`,
          `Exit code: ${result.exitCode}`,
          result.timedOut ? 'Status: TIMED OUT' : '',
          result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
          result.stderr ? `stderr:\n${result.stderr}` : '',
        ].filter(Boolean).join('\n');
        
        onEvent({ type: 'status', stage: 'reviewer', label: `Stage 4: Workspace Review (${iteration})` });
        const reviewPrompt = `TASK:\n${task}\n\nPLAN:\n${plan}\n\nGENERATED MANIFEST:\n${text}\n\nTEST RESULTS:\n${summary}`;
        const { text: review, usage: reviewUsage } = await reviewer.call(reviewPrompt, signal);
        trackUsage('reviewer', config.reviewer.model, reviewUsage);
        runLog.reviewer += `\n--- ITERATION ${iteration} ---\n${review}\n`;
        onEvent({ type: 'output', role: 'reviewer', text: review, iteration });
        await logTranscript('reviewer', runHeader + runLog.reviewer);
        const allowedVerdicts = new Set(['PASS', 'FAIL']);
        const parsedResult = parseVerdict(review, allowedVerdicts);
        if (!parsedResult.parsed) {
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[Parse Warning] Failed to parse workspace review verdict: "${review}"\x1b[0m\r\n` });
          await logTranscript('reviewer', `\n[PARSE FAILURE] Failed to parse verdict from workspace review:\n${review}\n`);
        }
        approved = parsedResult.verdict === 'PASS' && result.exitCode === 0 && !result.timedOut;
        if (approved) {
          pipelinePassed = true;
          completedWorkspaceDir = workspace.directory;
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[PASS] Project preserved at ${workspace.directory}\x1b[0m\r\n` });
        } else {
          pipelinePassed = false;
          const feedback = parsedResult.feedback || summary;
          coderPrompt = `TASK:\n${task}\n\nARCHITECTURE PLAN:\n${plan}\n\nPREVIOUS ATTEMPT RESULTS:\n${summary}\n\nREVIEWER FEEDBACK:\n${feedback}\n\nReturn a complete corrected workspace JSON manifest.`;
        }
      }
      if (!approved) {
        throw new Error(`Failed to produce a passing workspace after ${maxIterations} iterations.`);
      }
    } else if (mode === 2) {
      const designerAgent = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS_MODE2.designer });
      const coderAgent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS_MODE2.coder });
      const promptSupervisor = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_MODE2.supervisorPromptCheck });
      const codeSupervisor = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS_MODE2.supervisorCodeCheck });

      let spec = '';
      let specApproved = false;

      // ── Stage 1 & 4 (Prompt Loop) ──
      onEvent({ type: 'status', stage: 'architect', label: 'Stage 1: Prompt Designer' });
      let designerPrompt = `TASK:\n${task}`;
      let promptLoopCount = 0;

      while (promptLoopCount < maxIterations && !specApproved) {
        checkAbort();
        promptLoopCount++;
        const iterHeader = `\n--- ITERATION ${promptLoopCount} ---\n`;
        
        // Call Prompt Designer
        onEvent({ type: 'pty', role: 'architect', data: `\r\n\x1b[35m[Iteration ${promptLoopCount}] Running Prompt Designer...\x1b[0m\r\n` });
        const { text, usage } = await designerAgent.call(designerPrompt, signal);
        trackUsage('architect', config.architect.model, usage);
        spec = text;
        runLog.architect += iterHeader + text + '\n';
        onEvent({ type: 'output', role: 'architect', text, iteration: promptLoopCount });
        await logTranscript('architect', runHeader + iterHeader + text + '\n');

        // Call Supervisor for Prompt Check
        checkAbort();
        onEvent({ type: 'status', stage: 'reviewer', label: `Stage 4: Supervisor (Prompt Check ${promptLoopCount})` });
        onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[35m[Iteration ${promptLoopCount}] Running Supervisor (Prompt Check)...\x1b[0m\r\n` });
        
        const { text: supervisorResult, usage: checkUsage } = await promptSupervisor.call(`SPECIFICATION TO REVIEW:\n${spec}`, signal);
        trackUsage('reviewer', config.reviewer.model, checkUsage);
        runLog.reviewer += iterHeader + '[Prompt Check]\n' + supervisorResult + '\n';
        onEvent({ type: 'output', role: 'reviewer', text: supervisorResult, iteration: promptLoopCount, label: 'Prompt Check' });
        await logTranscript('reviewer', runHeader + iterHeader + '[Prompt Check]\n' + supervisorResult + '\n');

        // Parse verdict
        const allowedVerdicts = new Set(['GREENLIGHT', 'FIX']);
        const parsedResult = parseVerdict(supervisorResult, allowedVerdicts);
        if (!parsedResult.parsed) {
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[Parse Warning] Failed to parse supervisor prompt verdict: "${supervisorResult}"\x1b[0m\r\n` });
          await logTranscript('reviewer', `\n[PARSE FAILURE] Failed to parse verdict from supervisor prompt review:\n${supervisorResult}\n`);
        }
        const verdict = parsedResult.verdict || 'FIX';
        if (verdict === 'GREENLIGHT') {
          specApproved = true;
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[GREENLIGHT] Specification approved by Supervisor.\x1b[0m\r\n` });
        } else {
          const feedback = parsedResult.feedback || 'Please refine the specification.';
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[FIX] Supervisor requested refinement.\x1b[0m\r\n` });
          
          // Update Prompt Designer's next prompt with feedback
          designerPrompt = `SPECIFICATION GENERATED:\n${spec}\n\nSUPERVISOR FEEDBACK:\n${feedback}\n\nPlease update the specification to address this feedback.`;
          // Set state back to architect
          onEvent({ type: 'status', stage: 'architect', label: `Stage 1: Prompt Designer (Iteration ${promptLoopCount + 1})` });
        }
      }

      if (!specApproved) {
        throw new Error(`Failed to design a specification acceptable to the Supervisor after ${maxIterations} iterations.`);
      }

      // ── Stage 2 & 4 (Code Loop) ──
      let codeApproved = false;
      let codeLoopCount = 0;
      let coderPrompt = `SPECIFICATION:\n${spec}`;
      let code = '';

      while (codeLoopCount < maxIterations && !codeApproved) {
        checkAbort();
        codeLoopCount++;
        const iterHeader = `\n--- ITERATION ${codeLoopCount} ---\n`;

        // Call Coder (Developer)
        onEvent({ type: 'status', stage: 'developer', label: `Stage 2: Coder (Iteration ${codeLoopCount})` });
        onEvent({ type: 'pty', role: 'developer', data: `\r\n\x1b[35m[Iteration ${codeLoopCount}] Running Coder...\x1b[0m\r\n` });
        const { text, usage } = await coderAgent.call(coderPrompt, signal);
        trackUsage('developer', config.developer.model, usage);
        code = stripCodeFences(text);
        runLog.developer += iterHeader + code + '\n';
        onEvent({ type: 'output', role: 'developer', text: code, iteration: codeLoopCount });
        await logTranscript('developer', runHeader + iterHeader + code + '\n');

        // Run Sandbox
        checkAbort();
        onEvent({ type: 'status', stage: 'sandbox', label: 'Stage 3: Sandbox' });
        let sandboxResult;
        try {
          sandboxResult = await runSandboxed(code, {
            timeoutMs: 10000,
            onOutput: (text, kind) => {
              const data = kind === 'stderr' ? `\x1b[31m${text}\x1b[0m` : text;
              onEvent({ type: 'pty', role: 'developer', data });
            },
            signal,
          });
          const sandboxLog = `\n// EXIT: ${sandboxResult.exitCode}${sandboxResult.timedOut ? ' (TIMED OUT)' : ''}\n// stdout:\n${sandboxResult.stdout}`;
          await logTranscript('developer', sandboxLog);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
        }
        checkAbort();
        onEvent({ type: 'sandbox', ...sandboxResult });

        // Call Supervisor for Code Check
        onEvent({ type: 'status', stage: 'reviewer', label: `Stage 4: Supervisor (Code Check ${codeLoopCount})` });
        onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[35m[Iteration ${codeLoopCount}] Running Supervisor (Code Check)...\x1b[0m\r\n` });

        const executionSummary = [
          `Exit code: ${sandboxResult.exitCode ?? 0}`,
          sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
          sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
          sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
        ].filter(Boolean).join('\n');

        const prompt = `SPECIFICATION:\n${spec}\n\nCODE GENERATED:\n${code}\n\nSANDBOX RUN RESULTS:\n${executionSummary}`;
        const { text: supervisorResult, usage: checkUsage } = await codeSupervisor.call(prompt, signal);
        trackUsage('reviewer', config.reviewer.model, checkUsage);
        runLog.reviewer += iterHeader + '[Code Check]\n' + supervisorResult + '\n';
        onEvent({ type: 'output', role: 'reviewer', text: supervisorResult, iteration: codeLoopCount, label: 'Code Check' });
        await logTranscript('reviewer', runHeader + iterHeader + '[Code Check]\n' + supervisorResult + '\n');

        // Parse verdict
        const allowedVerdicts = new Set(['PASS', 'FAIL']);
        const parsedResult = parseVerdict(supervisorResult, allowedVerdicts);
        if (!parsedResult.parsed) {
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[Parse Warning] Failed to parse supervisor code verdict: "${supervisorResult}"\x1b[0m\r\n` });
          await logTranscript('reviewer', `\n[PARSE FAILURE] Failed to parse verdict from supervisor code review:\n${supervisorResult}\n`);
        }
        const verdict = parsedResult.verdict || 'FAIL';
        if (verdict === 'PASS' && sandboxResult.exitCode === 0 && !sandboxResult.timedOut) {
          codeApproved = true;
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[32m[PASS] Code approved by Supervisor.\x1b[0m\r\n` });
        } else {
          pipelinePassed = false;
          const feedback = parsedResult.feedback || 'Please fix the code.';
          onEvent({ type: 'pty', role: 'reviewer', data: `\r\n\x1b[31m[FAIL] Supervisor flagged code issues.\x1b[0m\r\n` });

          // Update Coder's prompt with feedback and sandbox results
          coderPrompt = `PREVIOUS CODE:\n${code}\n\nSANDBOX RUN RESULTS:\n${executionSummary}\n\nSUPERVISOR FEEDBACK:\n${feedback}\n\nPlease update the code to fix these issues. Output ONLY the updated Javascript code, no comments or markdown.`;
        }
      }

      if (!codeApproved) {
        throw new Error(`Failed to write code that passes Supervisor checks after ${maxIterations} iterations.`);
      }
    } else {
      // ── Mode 1: Sequential Pipeline ──
      checkAbort();
      onEvent({ type: 'status', stage: 'architect', label: 'Stage 1: Claude Code' });
      const architect = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS.architect });
      const { text: plan, usage: planUsage } = await architect.call(task, signal);
      trackUsage('architect', config.architect.model, planUsage);
      runLog.architect = plan;
      onEvent({ type: 'output', role: 'architect', text: plan, iteration: 1 });
      await logTranscript('architect', runHeader + plan + '\n');

      checkAbort();
      onEvent({ type: 'status', stage: 'developer', label: 'Stage 2: Codex' });
      const developer = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS.developer });
      const prompt = `TASK:\n${task}\n\nPLAN:\n${plan}`;
      const { text: coderResult, usage: coderUsage } = await developer.call(prompt, signal);
      trackUsage('developer', config.developer.model, coderUsage);
      const code = stripCodeFences(coderResult);
      runLog.developer = code;
      onEvent({ type: 'output', role: 'developer', text: code, iteration: 1 });
      await logTranscript('developer', runHeader + code + '\n');

      checkAbort();
      onEvent({ type: 'status', stage: 'sandbox', label: 'Stage 3: Sandbox' });
      let sandboxResult;
      try {
        sandboxResult = await runSandboxed(code, {
          timeoutMs: 10000,
          onOutput: (text, kind) => {
            const data = kind === 'stderr' ? `\x1b[31m${text}\x1b[0m` : text;
            onEvent({ type: 'pty', role: 'developer', data });
          },
          signal,
        });
        const sandboxLog = `\n// EXIT: ${sandboxResult.exitCode}${sandboxResult.timedOut ? ' (TIMED OUT)' : ''}\n// stdout:\n${sandboxResult.stdout}`;
        await logTranscript('developer', sandboxLog);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
      }
      checkAbort();
      onEvent({ type: 'sandbox', ...sandboxResult });

      onEvent({ type: 'status', stage: 'reviewer', label: 'Stage 4: Antigravity' });
      const reviewer = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS.reviewer });
      const executionSummary = [
        `Exit code: ${sandboxResult.exitCode ?? 0}`,
        sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
        sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
        sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
      ].filter(Boolean).join('\n');

      const reviewPrompt = `TASK:\n${task}\n\nARCHITECT PLAN:\n${runLog.architect}\n\nCODE:\n${runLog.developer}\n\nEXECUTION RESULTS:\n${executionSummary}`;
      const { text: reviewText, usage: reviewerUsage } = await reviewer.call(reviewPrompt, signal);
      trackUsage('reviewer', config.reviewer.model, reviewerUsage);
      runLog.reviewer = reviewText;
      pipelinePassed = sandboxResult.exitCode === 0 && !sandboxResult.timedOut && !/\bFAIL\b/i.test(reviewText);
      onEvent({ type: 'output', role: 'reviewer', text: reviewText, iteration: 1 });
      await logTranscript('reviewer', runHeader + reviewText + '\n');
    }

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

    const costRecords = records.map(({ role, model, inputTokens, outputTokens }) => {
      const [inRate, outRate] = getRates(model);
      const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
      return { role, model, inputTokens, outputTokens, cost };
    });
    const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
    onEvent({ type: 'cost', records: costRecords, total });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    onEvent({ type: 'done', elapsed, passed: pipelinePassed, completedWorkspaceDir });

  } catch (err) {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', stage: 'architect', message: err.message });
    }
    
    const costRecords = records.map(({ role, model, inputTokens, outputTokens }) => {
      const [inRate, outRate] = getRates(model);
      const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
      return { role, model, inputTokens, outputTokens, cost };
    });
    const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
    onEvent({ type: 'cost', records: costRecords, total });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    onEvent({ type: 'done', elapsed, passed: false });
    throw err;
  }
}
