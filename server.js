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

async function runPipeline(ws, task, config) {
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
    sessionUsage[role] = {
      inputTokens:  usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: (usage.inputTokens / 1e6) * inRate + (usage.outputTokens / 1e6) * outRate,
    };
  };

  const startTime = Date.now();

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

  // ── Stage 2: Developer (receives architect plan as context) ──
  send({ type: 'status', stage: 'developer', label: 'Stage 2: Developer' });
  let code;
  try {
    const agent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS.developer });
    const { text, usage } = await agent.call(plan);
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

  // ── Stage 4: Reviewer (receives architect plan + developer code + execution results) ──
  send({ type: 'status', stage: 'reviewer', label: 'Stage 4: Reviewer' });
  try {
    const executionSummary = [
      `Exit code: ${sandboxResult.exitCode ?? 0}`,
      sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
      sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
      sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `ARCHITECT PLAN:\n${runLog.architect}\n\nCODE:\n${runLog.developer}\n\nEXECUTION RESULTS:\n${executionSummary}`;
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

  const costRecords = computeCosts(records);
  const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
  send({ type: 'cost', records: costRecords, total });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  send({ type: 'done', elapsed });
}

// ── EXPRESS + HTTP SERVER ──
const app = express();
app.use(express.json());
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
      await runPipeline(ws, msg.task, msg.config);
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
