import test from 'node:test';
import assert from 'node:assert/strict';

import { runArchitect } from '../orchestrator.js';

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
