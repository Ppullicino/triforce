import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runArchitect } from '../orchestrator.js';
import { executePipeline } from '../pipeline.js';
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
