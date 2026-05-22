import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { exec } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const TASK = `Create a JavaScript function that takes an array of numbers, removes duplicates, sorts them in ascending order, and returns the result. Include a test that proves it works.`;

const ARCHITECT_MODEL = process.env.ARCHITECT_MODEL || 'claude-sonnet-4-6';
const DEVELOPER_MODEL = process.env.DEVELOPER_MODEL || 'gemini-2.5-flash';
const REVIEWER_MODEL  = process.env.REVIEWER_MODEL  || 'gemini-2.5-flash';

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

async function runArchitect(anthropic) {
  console.log('\n=== STAGE 1: ARCHITECT (Claude) ===');
  const msg = await anthropic.messages.create({
    model: ARCHITECT_MODEL,
    max_tokens: 1024,
    system: 'You are the Architect agent in the Triforce system. Your job is to analyze a coding task and produce a clear, structured implementation plan. Output ONLY the plan as numbered steps. No code. No markdown formatting. No preamble.',
    messages: [{ role: 'user', content: TASK }],
  });
  const plan = msg.content[0].text;
  console.log(plan);
  return plan;
}

async function runDeveloper(gemini, plan) {
  console.log('\n=== STAGE 2: DEVELOPER (Gemini) ===');
  const response = await gemini.models.generateContent({
    model: DEVELOPER_MODEL,
    config: {
      systemInstruction: 'You are the Developer agent in the Triforce system. You receive an implementation plan and your job is to write the code. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js.',
    },
    contents: plan,
  });
  const raw = response.text;
  const code = stripCodeFences(raw);
  console.log(code);
  return code;
}

async function runSandbox(code) {
  console.log('\n=== STAGE 3: SANDBOX EXECUTION ===');
  const result = await runInSandbox(code);
  if (result.timedOut) {
    console.log('[TIMED OUT after 10 seconds]');
  }
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error('[stderr]', result.stderr);
  if (!result.stdout && !result.stderr && !result.timedOut) {
    console.log('[No output]');
  }
  return result;
}

async function runReviewer(gemini, code, sandboxResult) {
  console.log('\n=== STAGE 4: REVIEWER (Gemini) ===');
  const executionSummary = [
    `Exit code: ${sandboxResult.exitCode ?? 0}`,
    sandboxResult.timedOut ? 'Status: TIMED OUT' : '',
    sandboxResult.stdout ? `stdout:\n${sandboxResult.stdout}` : 'stdout: (empty)',
    sandboxResult.stderr ? `stderr:\n${sandboxResult.stderr}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `CODE:\n${code}\n\nEXECUTION RESULTS:\n${executionSummary}`;
  const response = await gemini.models.generateContent({
    model: REVIEWER_MODEL,
    config: {
      systemInstruction: 'You are the Reviewer agent in the Triforce system. You receive code written by another agent and the terminal output from executing that code. Analyze both and produce a clear Pass/Fail verdict. If Pass: confirm what worked. If Fail: identify exactly what went wrong and what should be fixed. Be concise and specific.',
    },
    contents: prompt,
  });
  console.log(response.text);
}

async function main() {
  const startTime = Date.now();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set in .env');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  console.log('TRIFORCE PHASE 0 — Starting pipeline...');
  console.log(`Task: ${TASK}`);
  console.log(`Models — Architect: ${ARCHITECT_MODEL} | Developer: ${DEVELOPER_MODEL} | Reviewer: ${REVIEWER_MODEL}`);

  let plan, code, sandboxResult;

  try {
    plan = await runArchitect(anthropic);
  } catch (err) {
    console.error(`\nSTAGE 1 FAILED: ${err.message}`);
    process.exit(1);
  }

  try {
    code = await runDeveloper(gemini, plan);
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
    await runReviewer(gemini, code, sandboxResult);
  } catch (err) {
    console.error(`\nSTAGE 4 FAILED: ${err.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== TRIFORCE PHASE 0 COMPLETE === (${elapsed}s)`);
}

main();
