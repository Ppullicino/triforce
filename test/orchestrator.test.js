import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runArchitect } from '../orchestrator.js';
import { executePipeline, parseVerdict, stripCodeFences } from '../pipeline.js';
import { Agent } from '../agent.js';

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

test('executePipeline Mode 1 executes all stages and completes successfully', async () => {
  const originalCall = Agent.prototype.call;
  Agent.prototype.call = async function(prompt) {
    if (this.systemPrompt.includes('Architect')) {
      return { text: '1. plan', usage: { inputTokens: 5, outputTokens: 10 } };
    }
    if (this.systemPrompt.includes('Developer')) {
      return { text: 'console.log("hello")', usage: { inputTokens: 10, outputTokens: 20 } };
    }
    if (this.systemPrompt.includes('Reviewer')) {
      return { text: 'VERDICT: PASS\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
    }
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  try {
    const events = [];
    const config = {
      architect: { provider: 'google', model: 'gemini-2.5-flash' },
      developer: { provider: 'google', model: 'gemini-2.5-flash' },
      reviewer: { provider: 'google', model: 'gemini-2.5-flash' },
    };

    await executePipeline(
      'some task',
      config,
      1,
      {
        packageRoot: join(__dirname, '..'),
      },
      (event) => {
        events.push(event);
      }
    );

    const types = events.map(e => e.type);
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
  }
});

test('executePipeline Mode 2 executes loops and completes successfully', async () => {
  const originalCall = Agent.prototype.call;
  Agent.prototype.call = async function(prompt) {
    if (this.systemPrompt.includes('Designer')) {
      return { text: 'spec', usage: { inputTokens: 5, outputTokens: 10 } };
    }
    if (this.systemPrompt.includes('Coder')) {
      return { text: 'console.log("hello")', usage: { inputTokens: 10, outputTokens: 20 } };
    }
    if (this.systemPrompt.includes('Supervisor')) {
      if (prompt.includes('SPECIFICATION TO REVIEW')) {
        return { text: 'VERDICT: GREENLIGHT\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
      }
      return { text: 'VERDICT: PASS\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
    }
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  try {
    const events = [];
    const config = {
      architect: { provider: 'google', model: 'gemini-2.5-flash' },
      developer: { provider: 'google', model: 'gemini-2.5-flash' },
      reviewer: { provider: 'google', model: 'gemini-2.5-flash' },
      maxIterations: 2,
    };

    await executePipeline(
      'some task',
      config,
      2,
      {
        packageRoot: join(__dirname, '..'),
      },
      (event) => {
        events.push(event);
      }
    );

    const doneEvent = events.find(e => e.type === 'done');
    assert.equal(doneEvent.passed, true, 'mode 2 pipeline finishes successfully');
  } finally {
    Agent.prototype.call = originalCall;
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

test('executePipeline Mode 2 handles unparseable supervisor prompt check and emits event', async () => {
  const originalCall = Agent.prototype.call;
  let supervisorCallCount = 0;
  Agent.prototype.call = async function(prompt) {
    if (this.systemPrompt.includes('Designer')) {
      return { text: 'spec', usage: { inputTokens: 5, outputTokens: 10 } };
    }
    if (this.systemPrompt.includes('Coder')) {
      return { text: 'console.log("hello")', usage: { inputTokens: 10, outputTokens: 20 } };
    }
    if (this.systemPrompt.includes('Supervisor')) {
      if (prompt.includes('SPECIFICATION TO REVIEW')) {
        supervisorCallCount++;
        if (supervisorCallCount === 1) {
          return { text: 'No verdict here, just random chat.', usage: { inputTokens: 15, outputTokens: 5 } };
        }
        return { text: 'VERDICT: GREENLIGHT\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
      }
      return { text: 'VERDICT: PASS\nFEEDBACK: ok', usage: { inputTokens: 15, outputTokens: 5 } };
    }
    return { text: 'default', usage: { inputTokens: 1, outputTokens: 1 } };
  };

  try {
    const events = [];
    const config = {
      architect: { provider: 'claude-cli', model: 'claude-cli-default' },
      developer: { provider: 'claude-cli', model: 'claude-cli-default' },
      reviewer: { provider: 'claude-cli', model: 'claude-cli-default' },
      maxIterations: 3,
    };

    await executePipeline(
      'some task',
      config,
      2,
      {
        packageRoot: join(__dirname, '..'),
      },
      (event) => {
        events.push(event);
      }
    );

    const doneEvent = events.find(e => e.type === 'done');
    assert.equal(doneEvent.passed, true, 'mode 2 pipeline finishes successfully');
    
    const parseWarningEvent = events.find(e => e.type === 'pty' && e.data.includes('[Parse Warning]'));
    assert.ok(parseWarningEvent, 'should emit a [Parse Warning] pty event');
  } finally {
    Agent.prototype.call = originalCall;
  }
});
