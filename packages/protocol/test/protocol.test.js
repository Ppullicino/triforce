import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION, isCompatibleProtocol, validateClientCommand, validateServerEvent,
  normalizePipelineConfig, capabilities,
} from '../src/index.js';

const config = Object.fromEntries(['architect', 'developer', 'reviewer'].map(role => [role, { provider: 'claude-cli', model: 'claude-cli-default' }]));

test('protocol version is 1.2.0, major 1', () => {
  assert.equal(PROTOCOL_VERSION, '1.2.0');
  assert.equal(capabilities.protocolMajor, 1);
  assert.deepEqual([...capabilities.modes], [1, 2, 3]);
  for (const f of ['filesystem', 'deliberation', 'apply', 'verified-chat']) {
    assert.ok(capabilities.features.includes(f), `capabilities advertises ${f}`);
  }
});

test('validates run and replay commands', () => {
  assert.equal(validateClientCommand({ type: 'run', task: 'Build it', config, mode: 3 }).success, true);
  assert.equal(validateClientCommand({ type: 'subscribe', runId: crypto.randomUUID(), afterEventId: 4 }).success, true);
  assert.equal(validateClientCommand({ type: 'cancel', runId: crypto.randomUUID() }).success, true);
});

test('accepts new build positions and mode 2/3 tuning', () => {
  const newPositions = Object.fromEntries(['promptDesigner', 'coder', 'supervisor'].map(p => [p, { provider: 'claude-cli', model: 'claude-cli-default' }]));
  assert.equal(validateClientCommand({ type: 'run', task: 'x', config: newPositions, mode: 1 }).success, true);
  assert.equal(validateClientCommand({ type: 'run', task: 'x', config: { pool: ['claude-cli', 'agy-cli'], deliberate: true }, mode: 2 }).success, true);
  assert.equal(validateClientCommand({ type: 'run', task: 'x', config: { pool: ['not-a-cli'] }, mode: 2 }).success, false);
});

test('validates the protocol 1.2 command families', () => {
  assert.equal(validateClientCommand({ type: 'fs.roots' }).success, true);
  assert.equal(validateClientCommand({ type: 'fs.list', path: '/home/me/project' }).success, true);
  assert.equal(validateClientCommand({ type: 'fs.stat', path: '/home/me/project/a.js' }).success, true);
  assert.equal(validateClientCommand({ type: 'fs.selectWorking', path: '/home/me/project' }).success, true);
  assert.equal(validateClientCommand({ type: 'fs.list' }).success, false);

  const runId = crypto.randomUUID();
  assert.equal(validateClientCommand({ type: 'apply', runId, scope: 'files', paths: ['a.js'] }).success, true);
  assert.equal(validateClientCommand({ type: 'apply', runId }).data.scope, 'all');
  assert.equal(validateClientCommand({ type: 'apply', runId: 'nope' }).success, false);

  assert.equal(validateClientCommand({ type: 'chat', message: 'hello' }).success, true);
  assert.equal(validateClientCommand({ type: 'chat', message: 'hello', pool: ['claude-cli'], fast: true, folder: '/home/me/p' }).success, true);
  assert.equal(validateClientCommand({ type: 'chat', message: '' }).success, false);
});

test('rejects malformed commands and incompatible major versions', () => {
  assert.equal(validateClientCommand({ type: 'run', task: '', config }).success, false);
  assert.equal(validateClientCommand({ type: 'subscribe', runId: '../escape' }).success, false);
  assert.equal(isCompatibleProtocol('1.8.2'), true);
  assert.equal(isCompatibleProtocol('1.1.0'), true);
  assert.equal(isCompatibleProtocol('2.0.0'), false);
});

test('validates the extended server event vocabulary', () => {
  assert.equal(validateServerEvent({ type: 'status', stage: 'architect' }).success, true);
  for (const type of ['fs_list', 'diff', 'apply_result', 'route', 'deliberation', 'chat_message']) {
    assert.equal(validateServerEvent({ type }).success, true, `event ${type} is valid`);
  }
  assert.equal(validateServerEvent({ type: 'invented-event' }).success, false);
});

test('normalizePipelineConfig maps legacy roles to build positions and keeps both', () => {
  const norm = normalizePipelineConfig({
    architect: { provider: 'claude-cli', model: 'a' },
    developer: { provider: 'codex-cli', model: 'b' },
    reviewer: { provider: 'agy-cli', model: 'c' },
  });
  assert.deepEqual(norm.promptDesigner, { provider: 'claude-cli', model: 'a' });
  assert.deepEqual(norm.coder, { provider: 'codex-cli', model: 'b' });
  assert.deepEqual(norm.supervisor, { provider: 'agy-cli', model: 'c' });
  assert.deepEqual(norm.architect, { provider: 'claude-cli', model: 'a' });

  const newStyle = normalizePipelineConfig({ promptDesigner: { provider: 'agy-cli', model: 'x' } });
  assert.deepEqual(newStyle.architect, { provider: 'agy-cli', model: 'x' });
  assert.deepEqual(normalizePipelineConfig(), {});
});
