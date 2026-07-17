import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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

test('CLI early exit with large stdin rejects with the CLI error without uncaught EPIPE', async () => {
  const child = spawn(process.execPath, ['-e', "process.stderr.write('intentional failure'); process.exit(1)"], {
    detached: process.platform !== 'win32',
  });

  await assert.rejects(new Promise((resolve, reject) => {
    Agent.prototype._collectChild(child, 'x'.repeat(16 * 1024 * 1024), 'node', resolve, reject);
  }), /node CLI exited with code 1\. Stderr: intentional failure/);
});

test('CLI timeout kills the child tree once and settles once', async () => {
  const child = new EventEmitter();
  child.pid = 123456789;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killCount++; };

  let killCount = 0;
  const originalProcessKill = process.kill;
  process.kill = () => { killCount++; return true; };
  try {
    await assert.rejects(new Promise((resolve, reject) => {
      Agent.prototype._collectChild(child, null, 'hanging', resolve, reject, 10);
    }), /hanging CLI timed out after 10ms/);
    child.emit('close', 1);
    child.emit('error', new Error('late error'));
  } finally {
    process.kill = originalProcessKill;
  }

  assert.equal(killCount, 1);
});

test('Codex CLI can run when Triforce starts outside a Git repository', () => {
  const args = Agent.prototype._codexCLIArgs.call({
    unsafePermissions: false,
    systemPrompt: '',
  });

  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '-']);
});

test('Codex CLI preserves configured permissions and system prompt', () => {
  const args = Agent.prototype._codexCLIArgs.call({
    unsafePermissions: true,
    systemPrompt: 'Review carefully',
  });

  assert.deepEqual(args, [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '-c',
    'system_prompt="Review carefully"',
    '-',
  ]);
});
