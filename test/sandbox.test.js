import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSandboxed } from '../sandbox.js';

test('executes ordinary JavaScript', async () => {
  const result = await runSandboxed('console.log([...new Set([3,1,3])].sort())');
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /1, 3/);
});

test('blocks host filesystem writes', async () => {
  const target = join(tmpdir(), `triforce-host-write-${process.pid}`);
  const result = await runSandboxed(`require('node:fs').writeFileSync(${JSON.stringify(target)}, 'bad')`);
  assert.notEqual(result.exitCode, 0);
  await assert.rejects(access(target));
});

test('blocks child processes', async () => {
  const result = await runSandboxed("require('node:child_process').execFileSync('/bin/true')");
  assert.notEqual(result.exitCode, 0);
});

test('blocks network syscalls', async () => {
  const result = await runSandboxed("fetch('https://example.com').then(()=>console.log('connected'))");
  assert.notEqual(result.exitCode, 0);
  assert.doesNotMatch(result.stdout, /connected/);
});

test('terminates runaway programs', async () => {
  const result = await runSandboxed('setInterval(() => {}, 1000)', { timeoutMs: 500 });
  assert.equal(result.timedOut, true);
});
