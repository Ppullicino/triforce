import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runArchitect, main } from '../orchestrator.js';
import { executePipeline, parseVerdict, stripCodeFences } from '../pipeline.js';
import { Agent } from '../agent.js';
import { checkConfigForWarnings, getRates } from '../models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('runArchitect passes the Mode 1 task to the architect agent', async () => {
  const task = 'trivial task';
  const calls = [];
  const agent = {
    provider: 'stub',
    model: 'stub-model',
    async call(prompt) {
      calls.push(prompt);
      return {
        text: '1. Implement the trivial task',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };

  const originalLog = console.log;
  console.log = () => {};
  try {
    const plan = await runArchitect(agent, task);
    assert.equal(plan, '1. Implement the trivial task');
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, [task]);
});

const BUILD_MANIFEST = JSON.stringify({
  files: [
    { path: 'index.js', content: 'export const two = 1 + 1;\n' },
    { path: 'test.js', content: "import { two } from './index.js';\nif (two !== 2) process.exit(1);\n" },
  ],
  testFile: 'test.js',
});

async function tmpWorkspacesDir() {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  return mkdtemp(join(tmpdir(), 'triforce-build-test-'));
}

function buildConfig(extra = {}) {
  return {
    promptDesigner: { provider: 'claude-cli', model: 'claude-cli-default' },
    coder: { provider: 'claude-cli', model: 'claude-cli-default' },
    supervisor: { provider: 'claude-cli', model: 'claude-cli-default' },
    ...extra,
  };
}

test('executePipeline Mode 1 runs the structured-build loop and completes successfully', async () => {
  const originalCall = Agent.prototype.call;
  Agent.prototype.call = async function() {
    const p = this.systemPrompt;
    if (p.includes('Prompt Designer')) return { text: 'SPEC: expose two = 2', usage: { inputTokens: 5, outputTokens: 10 } };
    if (p.includes('reviewing an implementation spec')) return { text: 'VERDICT: APPROVE\nFEEDBACK: ok', usage: { inputTokens: 3, outputTokens: 2 } };
    if (p.includes('You are the Coder')) return { text: BUILD_MANIFEST, usage: { inputTokens: 10, outputTokens: 20 } };
    if (p.includes('reviewing generated code')) return { text: 'VERDICT: PASS\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  const workspacesDir = await tmpWorkspacesDir();
  try {
    const events = [];
    await executePipeline(
      'some task',
      buildConfig(),
      1,
      { packageRoot: join(__dirname, '..'), workspacesDir, dependencyRoot: join(__dirname, '..', 'node_modules') },
      (event) => { events.push(event); }
    );

    const types = events.map(e => e.type);
    assert.ok(types.includes('diff'), 'emits diff events');
    assert.ok(types.includes('status'), 'emits status events');
    assert.ok(types.includes('output'), 'emits output events');
    assert.ok(types.includes('sandbox'), 'emits sandbox result');
    assert.ok(types.includes('usage'), 'emits usage events');
    assert.ok(types.includes('cost'), 'emits cost events');
    assert.ok(types.includes('done'), 'emits done event');

    const doneEvent = events.find(e => e.type === 'done');
    assert.equal(doneEvent.passed, true, 'pipeline finishes successfully');
  } finally {
    Agent.prototype.call = originalCall;
    await import('node:fs/promises').then(fs => fs.rm(workspacesDir, { recursive: true, force: true }));
  }
});

test('executePipeline cost records surface usageUnknown only for unknown CLI usage', async () => {
  const originalCall = Agent.prototype.call;
  Agent.prototype.call = async function() {
    const p = this.systemPrompt;
    if (p.includes('Prompt Designer')) return { text: 'spec', usage: { inputTokens: 12, outputTokens: 34 } };
    if (p.includes('reviewing an implementation spec')) return { text: 'VERDICT: APPROVE', usage: { inputTokens: 0, outputTokens: 0, usageUnknown: true } };
    if (p.includes('You are the Coder')) return { text: BUILD_MANIFEST, usage: { inputTokens: 10, outputTokens: 20 } };
    if (p.includes('reviewing generated code')) return { text: 'VERDICT: PASS', usage: { inputTokens: 15, outputTokens: 5 } };
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  const workspacesDir = await tmpWorkspacesDir();
  try {
    const events = [];
    // promptDesigner -> tracked as 'architect' (known usage); supervisor prompt-check -> 'reviewer' (usageUnknown)
    await executePipeline('some task', buildConfig({ supervisor: { provider: 'agy-cli', model: 'agy-cli-default' } }), 1,
      { packageRoot: join(__dirname, '..'), workspacesDir, dependencyRoot: join(__dirname, '..', 'node_modules') },
      event => events.push(event));

    const costEvent = events.find(e => e.type === 'cost');
    assert.ok(costEvent, 'emits cost event');
    const architectRecord = costEvent.records.find(r => r.role === 'architect');
    const reviewerRecord = costEvent.records.find(r => r.role === 'reviewer' && r.usageUnknown);
    assert.ok(architectRecord.inputTokens > 0 && architectRecord.outputTokens > 0, 'known usage has non-zero tokens');
    assert.ok(!('usageUnknown' in architectRecord), 'known usage carries no usageUnknown flag');
    assert.ok(reviewerRecord, 'unknown CLI usage is flagged in cost records');
  } finally {
    Agent.prototype.call = originalCall;
    await import('node:fs/promises').then(fs => fs.rm(workspacesDir, { recursive: true, force: true }));
  }
});

test('executePipeline Mode 1 loops the Coder until the Supervisor passes', async () => {
  const originalCall = Agent.prototype.call;
  let coderCalls = 0;
  Agent.prototype.call = async function() {
    const p = this.systemPrompt;
    if (p.includes('Prompt Designer')) return { text: 'spec', usage: { inputTokens: 5, outputTokens: 10 } };
    if (p.includes('reviewing an implementation spec')) return { text: 'VERDICT: APPROVE', usage: { inputTokens: 3, outputTokens: 2 } };
    if (p.includes('You are the Coder')) {
      coderCalls++;
      return { text: BUILD_MANIFEST, usage: { inputTokens: 10, outputTokens: 20 } };
    }
    if (p.includes('reviewing generated code')) {
      return { text: coderCalls >= 2 ? 'VERDICT: PASS' : 'VERDICT: FAIL\nFEEDBACK: try again', usage: { inputTokens: 15, outputTokens: 5 } };
    }
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  const workspacesDir = await tmpWorkspacesDir();
  try {
    const events = [];
    await executePipeline('some task', buildConfig({ maxIterations: 3 }), 1,
      { packageRoot: join(__dirname, '..'), workspacesDir, dependencyRoot: join(__dirname, '..', 'node_modules') },
      event => events.push(event));

    assert.ok(coderCalls >= 2, 'Coder was re-run after a FAIL verdict');
    assert.equal(events.find(e => e.type === 'done').passed, true, 'build eventually passes');
  } finally {
    Agent.prototype.call = originalCall;
    await import('node:fs/promises').then(fs => fs.rm(workspacesDir, { recursive: true, force: true }));
  }
});

test('parseVerdict parses multiple formats correctly', () => {
  const cases = [
    {
      input: 'VERDICT: GREENLIGHT\nFEEDBACK: Refine it.',
      expected: { verdict: 'GREENLIGHT', feedback: 'Refine it.', parsed: true }
    },
    {
      input: '**VERDICT**: [GREENLIGHT]\n**FEEDBACK**: Looks good!',
      expected: { verdict: 'GREENLIGHT', feedback: 'Looks good!', parsed: true }
    },
    {
      input: 'verdict is greenlight. feedback is none.',
      expected: { verdict: 'GREENLIGHT', feedback: 'none.', parsed: true }
    },
    {
      input: '[VERDICT] PASS\n[FEEDBACK] ok',
      expected: { verdict: 'PASS', feedback: 'ok', parsed: true }
    },
    {
      input: 'VERDICT: FIX',
      expected: { verdict: 'FIX', feedback: '', parsed: true }
    },
    {
      input: 'The verdict is FIX because it needs more tests.',
      expected: { verdict: 'FIX', feedback: '', parsed: true }
    },
    {
      input: '**VERDICT**: FIX\n**FEEDBACK**: **The test fails**',
      expected: { verdict: 'FIX', feedback: 'The test fails', parsed: true }
    },
    {
      input: 'Preamble text\nVerdict: FAIL\nFeedback: Something is wrong.',
      expected: { verdict: 'FAIL', feedback: 'Something is wrong.', parsed: true }
    },
    {
      input: 'No verdict given at all here.',
      expected: { verdict: null, feedback: '', parsed: false }
    },
    {
      input: 'VERDICT: BLUE',
      allowedSet: new Set(['GREENLIGHT', 'FIX']),
      expected: { verdict: null, feedback: '', parsed: false }
    }
  ];

  for (const { input, allowedSet, expected } of cases) {
    const res = parseVerdict(input, allowedSet);
    assert.deepEqual(res, expected, `Failed for input: ${JSON.stringify(input)}`);
  }
});

test('stripCodeFences only strips leading and trailing fences, leaving inline fences intact', () => {
  const codeWithInlineFences = `const template = \`
\`\`\`html
<div>hello</div>
\`\`\`
\`;`;
  const input = `\`\`\`javascript\n${codeWithInlineFences}\n\`\`\``;
  const result = stripCodeFences(input);
  assert.equal(result, codeWithInlineFences);
});

test('executePipeline Mode 1 emits a [Parse Warning] when a Supervisor verdict is unparseable', async () => {
  const originalCall = Agent.prototype.call;
  let promptChecks = 0;
  Agent.prototype.call = async function() {
    const p = this.systemPrompt;
    if (p.includes('Prompt Designer')) return { text: 'spec', usage: { inputTokens: 5, outputTokens: 10 } };
    if (p.includes('reviewing an implementation spec')) {
      promptChecks++;
      return promptChecks === 1
        ? { text: 'No verdict here, just random chat.', usage: { inputTokens: 15, outputTokens: 5 } }
        : { text: 'VERDICT: APPROVE\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
    }
    if (p.includes('You are the Coder')) return { text: BUILD_MANIFEST, usage: { inputTokens: 10, outputTokens: 20 } };
    if (p.includes('reviewing generated code')) return { text: 'VERDICT: PASS', usage: { inputTokens: 15, outputTokens: 5 } };
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  const workspacesDir = await tmpWorkspacesDir();
  try {
    const events = [];
    await executePipeline('some task', buildConfig({ maxIterations: 3 }), 1,
      { packageRoot: join(__dirname, '..'), workspacesDir, dependencyRoot: join(__dirname, '..', 'node_modules') },
      event => events.push(event));

    assert.equal(events.find(e => e.type === 'done').passed, true, 'pipeline still finishes after re-designing the spec');
    assert.ok(events.some(e => e.type === 'pty' && e.data.includes('[Parse Warning]')), 'emits a [Parse Warning] pty event');
  } finally {
    Agent.prototype.call = originalCall;
    await import('node:fs/promises').then(fs => fs.rm(workspacesDir, { recursive: true, force: true }));
  }
});

test('main() propagates Stage 2 failure and prints Stage 1 token usage summary', async () => {
  const originalArgv = process.argv;
  const originalCall = Agent.prototype.call;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  process.argv = ['node', 'orchestrator.js', 'some task', '--mode', '1'];

  const originalEnv = { ...process.env };

  let callCount = 0;
  Agent.prototype.call = async function(prompt) {
    callCount++;
    if (callCount === 1) {
      return { text: '1. do step', usage: { inputTokens: 55, outputTokens: 99 } };
    }
    throw new Error('Simulated Stage 2 provider failure');
  };

  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(' '));
  };
  console.error = () => {};

  try {
    await assert.rejects(main(), /Simulated Stage 2 provider failure/);
    
    const summaryLogged = logs.some(line => line.includes('=== TOKEN USAGE ==='));
    const architectLogged = logs.some(line => line.includes('architect') && line.includes('in=55') && line.includes('out=99'));
    assert.ok(summaryLogged, 'should print token usage summary');
    assert.ok(architectLogged, 'should print Stage 1 token usage spend');
  } finally {
    process.argv = originalArgv;
    Agent.prototype.call = originalCall;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    // Restore process.env properties
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const key of Object.keys(originalEnv)) {
      process.env[key] = originalEnv[key];
    }
  }
});

test('checkConfigForWarnings logs warning for missing models', () => {
  const badConfig = {
    architect: { provider: 'claude-cli', model: 'claude-missing-model' },
    developer: { provider: 'codex-cli', model: 'codex-cli-default' },
    reviewer: { provider: 'unknown-provider', model: 'gemini-2.5-flash' }
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => { warnings.push(msg); };

  try {
    checkConfigForWarnings(badConfig);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /architect.*claude-missing-model/);
  assert.match(warnings[1], /reviewer.*unknown-provider/);
});

test('getRates logs one-time warning for unknown models', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => { warnings.push(msg); };

  try {
    const rates1 = getRates('completely-unknown-model');
    assert.deepEqual(rates1, [0, 0]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /completely-unknown-model/);

    const rates2 = getRates('completely-unknown-model');
    assert.deepEqual(rates2, [0, 0]);
    // should not have added any new warnings
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});
