import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Agent } from '../agent.js';

test('CLI startup errors reject instead of crashing or hanging', async () => {
  const child = spawn('/definitely/not/a/triforce-binary', [], { detached: true });
  await assert.rejects(new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, null, 'missing', resolve, reject);
  }), /Failed to start missing CLI/);
});

test('CLI output is collected into the provider result', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ok')"], { detached: true });
  const result = await new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, null, 'node', resolve, reject);
  });
  assert.equal(result.text, 'ok');
});
