import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import pty from '@homebridge/node-pty-prebuilt-multiarch';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Agent } from './agent.js';

const TRANSCRIPTS_DIR = './transcripts';
await mkdir(TRANSCRIPTS_DIR, { recursive: true });

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
};

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

const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';

function stripCodeFences(text) {
  return text
    .replace(/^```(?:javascript|js)?\n?/gm, '')
    .replace(/^```\n?/gm, '')
    .trim();
}

// Spawn code in a subprocess and stream stdout/stderr back over ws as pty events.
function runInSandbox(code, ws, timeoutMs = 10000) {
  return new Promise(async (resolve) => {
    await writeFile('sandbox.js', code, 'utf8');
    const child = spawn('node', ['sandbox.js']);
    let stdout = '', stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pty', role: 'developer', data: text }));
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pty', role: 'developer', data: '\x1b[31m' + text + '\x1b[0m' }));
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? 1, timedOut });
    });
  });
}

function computeCosts(records) {
  return records.map(({ role, model, inputTokens, outputTokens }) => {
    const [inRate, outRate] = RATES[model] ?? [0, 0];
    const cost = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
    return { role, model, inputTokens, outputTokens, cost };
  });
}

// ── MODULE-LEVEL USAGE (reset each run, read by /api/usage) ──
let sessionUsage = {
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
  const send = (data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
  const records = [];

  sessionUsage = {
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
  };

  const startTime = Date.now();

  if (mode === 2) {
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

    while (promptLoopCount < 3 && !specApproved) {
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
        await appendFile(`${TRANSCRIPTS_DIR}/architect.log`, runHeader + iterHeader + text + '\n');
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
        await appendFile(`${TRANSCRIPTS_DIR}/reviewer.log`, runHeader + iterHeader + '[Prompt Check]\n' + text + '\n');
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
      send({ type: 'error', stage: 'architect', message: 'Failed to design a specification acceptable to the Supervisor after 3 iterations.' });
      return;
    }

    // ── Stage 2 & 4 (Code Loop) ──
    let codeApproved = false;
    let codeLoopCount = 0;
    let coderPrompt = `SPECIFICATION:\n${spec}`;
    let code = '';

    while (codeLoopCount < 3 && !codeApproved) {
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
        await appendFile(`${TRANSCRIPTS_DIR}/developer.log`, runHeader + iterHeader + code + '\n');
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
        await appendFile(`${TRANSCRIPTS_DIR}/developer.log`, sandboxLog);
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
        await appendFile(`${TRANSCRIPTS_DIR}/reviewer.log`, runHeader + iterHeader + '[Code Check]\n' + text + '\n');
      } catch (err) {
        send({ type: 'error', stage: 'reviewer', message: err.message });
        return;
      }

      // Parse verdict
      const verdictMatch = supervisorResult.match(/VERDICT:\s*(\w+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FAIL';
      if (verdict === 'PASS') {
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
      send({ type: 'error', stage: 'reviewer', message: 'Failed to write code that passes Supervisor checks after 3 iterations.' });
      return;
    }

  } else {
    // ── Mode 1: Sequential Pipeline (with full context handoff / piggybacking) ──
    // ── Stage 1: Architect ──
    send({ type: 'status', stage: 'architect', label: 'Stage 1: Architect' });
    let plan;
    try {
      const agent = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS.architect });
      const { text, usage } = await agent.call(task);
      track('architect', config.architect.model, usage);
      plan = text;
      runLog.architect = text;
      send({ type: 'output', role: 'architect', text });
      await appendFile(`${TRANSCRIPTS_DIR}/architect.log`, runHeader + text + '\n');
    } catch (err) {
      send({ type: 'error', stage: 'architect', message: err.message });
      return;
    }

    // ── Stage 2: Developer (receives task + plan as context) ──
    send({ type: 'status', stage: 'developer', label: 'Stage 2: Developer' });
    let code;
    try {
      const agent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS.developer });
      const prompt = `TASK:\n${task}\n\nPLAN:\n${plan}`;
      const { text, usage } = await agent.call(prompt);
      track('developer', config.developer.model, usage);
      code = stripCodeFences(text);
      runLog.developer = code;
      send({ type: 'output', role: 'developer', text: code });
      await appendFile(`${TRANSCRIPTS_DIR}/developer.log`, runHeader + code + '\n');
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
      await appendFile(`${TRANSCRIPTS_DIR}/developer.log`, sandboxLog);
    } catch (err) {
      sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
    }
    send({ type: 'sandbox', ...sandboxResult });

    // ── Stage 4: Reviewer (receives task + plan + code + execution results) ──
    send({ type: 'status', stage: 'reviewer', label: 'Stage 4: Reviewer' });
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
      send({ type: 'output', role: 'reviewer', text });
      await appendFile(`${TRANSCRIPTS_DIR}/reviewer.log`, runHeader + text + '\n');
    } catch (err) {
      send({ type: 'error', stage: 'reviewer', message: err.message });
      return;
    }
  }

  const costRecords = computeCosts(records);
  const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
  send({ type: 'cost', records: costRecords, total });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  send({ type: 'done', elapsed });
}

// ── EXPRESS + HTTP SERVER ──
const app = express();
app.use(express.json());

// PWA-critical headers
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile('sw.js', { root: './public' });
});
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile('manifest.json', { root: './public' });
});

app.use('/icons', express.static('public/icons'));
app.use(express.static('public'));

app.get('/api/usage', (req, res) => {
  const total = Object.values(sessionUsage).reduce(
    (acc, r) => ({
      inputTokens:  acc.inputTokens  + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cost: acc.cost + r.cost,
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  );
  res.json({ ...sessionUsage, total });
});

app.get('/api/config', async (req, res) => {
  try {
    const raw = await readFile('./models.config.json', 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  // Spawn three persistent shells — one per agent role.
  // Shells survive across pipeline runs within this session.
  const shells = {};
  for (const role of ['architect', 'developer', 'reviewer']) {
    const shell = pty.spawn(SHELL, [], {
      name: 'xterm-color',
      cols: 120,
      rows: 40,
      cwd: process.cwd(),
      env: process.env,
    });
    shell.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pty', role, data }));
    });
    shells[role] = shell;
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'run') {
      await runPipeline(ws, msg.task, msg.config, msg.mode);
    } else if (msg.type === 'input') {
      // Keyboard input from browser xterm → persistent shell
      shells[msg.role]?.write(msg.data);
    } else if (msg.type === 'resize') {
      // Terminal resize from browser
      try { shells[msg.role]?.resize(msg.cols, msg.rows); } catch {}
    }
  });

  ws.on('close', () => {
    for (const shell of Object.values(shells)) {
      try { shell.kill(); } catch {}
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Triforce server running on http://localhost:${PORT}`));
