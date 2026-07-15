import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompatibleProtocol, validateClientCommand, validateServerEvent } from '../src/index.js';

const config = Object.fromEntries(['architect', 'developer', 'reviewer'].map(role => [role, { provider: 'openai', model: 'gpt-4.1' }]));

test('validates run and replay commands', () => {
  assert.equal(validateClientCommand({ type: 'run', task: 'Build it', config, mode: 3 }).success, true);
  assert.equal(validateClientCommand({ type: 'subscribe', runId: crypto.randomUUID(), afterEventId: 4 }).success, true);
});

test('rejects malformed commands and incompatible major versions', () => {
  assert.equal(validateClientCommand({ type: 'run', task: '', config }).success, false);
  assert.equal(validateClientCommand({ type: 'subscribe', runId: '../escape' }).success, false);
  assert.equal(isCompatibleProtocol('1.8.2'), true);
  assert.equal(isCompatibleProtocol('2.0.0'), false);
});

test('validates the bounded server event vocabulary', () => {
  assert.equal(validateServerEvent({ type: 'status', stage: 'architect' }).success, true);
  assert.equal(validateServerEvent({ type: 'invented-event' }).success, false);
});
