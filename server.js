import 'dotenv/config';
import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { Agent } from './agent.js';

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

function stripCodeFences(text) {
  return text
    .replace(/^```(?:javascript|js)?\n?/gm, '')
    .replace(/^```\n?/gm, '')
    .trim();
}

function runInSandbox(code, timeoutMs = 10000) {
  return new Promise(async (resolve) => {
    await writeFile('sandbox.js', code, 'utf8');
    exec('node sandbox.js', { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, exitCode: err ? err.code : 0, timedOut: err?.killed ?? false });
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

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/api/config', async (req, res) => {
  try {
    const raw = await readFile('./models.config.json', 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run', async (req, res) => {
  const { task, config } = req.body;

  if (!task?.trim()) return res.status(400).json({ error: 'task is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const records = [];
  const track = (role, model, usage) => records.push({ role, model, ...usage });
  const startTime = Date.now();

  // Stage 1: Architect
  send({ type: 'status', stage: 'architect', label: 'Stage 1: Architect' });
  let plan;
  try {
    const agent = new Agent({ ...config.architect, systemPrompt: SYSTEM_PROMPTS.architect });
    const { text, usage } = await agent.call(task);
    track('architect', config.architect.model, usage);
    plan = text;
    send({ type: 'output', role: 'architect', text });
  } catch (err) {
    send({ type: 'error', stage: 'architect', message: err.message });
    return res.end();
  }

  // Stage 2: Developer
  send({ type: 'status', stage: 'developer', label: 'Stage 2: Developer' });
  let code;
  try {
    const agent = new Agent({ ...config.developer, systemPrompt: SYSTEM_PROMPTS.developer });
    const { text, usage } = await agent.call(plan);
    track('developer', config.developer.model, usage);
    code = stripCodeFences(text);
    send({ type: 'output', role: 'developer', text: code });
  } catch (err) {
    send({ type: 'error', stage: 'developer', message: err.message });
    return res.end();
  }

  // Stage 3: Sandbox (shown in developer panel)
  send({ type: 'status', stage: 'sandbox', label: 'Stage 3: Sandbox' });
  let sandboxResult;
  try {
    sandboxResult = await runInSandbox(code);
  } catch (err) {
    sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
  }
  send({ type: 'sandbox', ...sandboxResult });

  // Stage 4: Reviewer
  send({ type: 'status', stage: 'reviewer', label: 'Stage 4: Reviewer' });
  try {
    const executionSummary = [
      `Exit code: ${sandboxResult.exitCode ?? 0}`,
      sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
      sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
      sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `CODE:\n${code}\n\nEXECUTION RESULTS:\n${executionSummary}`;
    const agent = new Agent({ ...config.reviewer, systemPrompt: SYSTEM_PROMPTS.reviewer });
    const { text, usage } = await agent.call(prompt);
    track('reviewer', config.reviewer.model, usage);
    send({ type: 'output', role: 'reviewer', text });
  } catch (err) {
    send({ type: 'error', stage: 'reviewer', message: err.message });
    return res.end();
  }

  const costRecords = computeCosts(records);
  const total = costRecords.reduce((sum, r) => sum + r.cost, 0);
  send({ type: 'cost', records: costRecords, total });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  send({ type: 'done', elapsed });
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Triforce server running on http://localhost:${PORT}`));
