import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { Agent } from './agent.js';
import { track, printSummary } from './usage.js';

const TASK = `Create a JavaScript function that takes an array of numbers, removes duplicates, sorts them in ascending order, and returns the result. Include a test that proves it works.`;

const SYSTEM_PROMPTS = {
  architect: 'You are the Architect agent in the Triforce system. Your job is to analyze a coding task and produce a clear, structured implementation plan. Output ONLY the plan as numbered steps. No code. No markdown formatting. No preamble.',
  developer: 'You are the Developer agent in the Triforce system. You receive an implementation plan and your job is to write the code. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
  reviewer:  'You are the Reviewer agent in the Triforce system. You receive code written by another agent and the terminal output from executing that code. Analyze both and produce a clear Pass/Fail verdict. If Pass: confirm what worked. If Fail: identify exactly what went wrong and what should be fixed. Be concise and specific.',
};

const PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GEMINI_API_KEY',
  openai:    'OPENAI_API_KEY',
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

async function loadConfig() {
  const raw = await readFile(new URL('./models.config.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

function validateApiKeys(config) {
  const needed = new Set(Object.values(config).map(c => c.provider));
  for (const provider of needed) {
    const envVar = PROVIDER_ENV[provider];
    if (envVar && !process.env[envVar]) {
      console.error(`ERROR: ${envVar} is not set (required for provider "${provider}")`);
      process.exit(1);
    }
  }
}

async function runArchitect(agent) {
  console.log(`\n=== STAGE 1: ARCHITECT (${agent.provider}/${agent.model}) ===`);
  const { text, usage } = await agent.call(TASK);
  track('architect', agent.model, usage);
  console.log(text);
  return text;
}

async function runDeveloper(agent, plan) {
  console.log(`\n=== STAGE 2: DEVELOPER (${agent.provider}/${agent.model}) ===`);
  const { text, usage } = await agent.call(plan);
  track('developer', agent.model, usage);
  const code = stripCodeFences(text);
  console.log(code);
  return code;
}

async function runSandbox(code) {
  console.log('\n=== STAGE 3: SANDBOX EXECUTION ===');
  const result = await runInSandbox(code);
  if (result.timedOut) console.log('[TIMED OUT after 10 seconds]');
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error('[stderr]', result.stderr);
  if (!result.stdout && !result.stderr && !result.timedOut) console.log('[No output]');
  return result;
}

async function runReviewer(agent, code, sandboxResult) {
  console.log(`\n=== STAGE 4: REVIEWER (${agent.provider}/${agent.model}) ===`);
  const executionSummary = [
    `Exit code: ${sandboxResult.exitCode ?? 0}`,
    sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
    sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
    sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `CODE:\n${code}\n\nEXECUTION RESULTS:\n${executionSummary}`;
  const { text, usage } = await agent.call(prompt);
  track('reviewer', agent.model, usage);
  console.log(text);
}

async function main() {
  const startTime = Date.now();
  const config = await loadConfig();
  validateApiKeys(config);

  const agents = Object.fromEntries(
    Object.entries(config).map(([role, { provider, model }]) => [
      role,
      new Agent({ provider, model, systemPrompt: SYSTEM_PROMPTS[role] }),
    ])
  );

  console.log('TRIFORCE PHASE 1 — Starting pipeline...');
  console.log(`Task: ${TASK}`);

  let plan, code, sandboxResult;

  try {
    plan = await runArchitect(agents.architect);
  } catch (err) {
    console.error(`\nSTAGE 1 FAILED: ${err.message}`);
    process.exit(1);
  }

  try {
    code = await runDeveloper(agents.developer, plan);
  } catch (err) {
    console.error(`\nSTAGE 2 FAILED: ${err.message}`);
    process.exit(1);
  }

  try {
    sandboxResult = await runSandbox(code);
  } catch (err) {
    console.error(`\nSTAGE 3 FAILED unexpectedly: ${err.message}`);
    sandboxResult = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
  }

  try {
    await runReviewer(agents.reviewer, code, sandboxResult);
  } catch (err) {
    console.error(`\nSTAGE 4 FAILED: ${err.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== TRIFORCE PHASE 1 COMPLETE === (${elapsed}s)`);
  printSummary();
}

main();
