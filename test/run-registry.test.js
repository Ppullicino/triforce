import test from 'node:test';
import assert from 'node:assert/strict';
import { RunRegistry } from '../run-registry.js';
import { join } from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

function socket() {
  return { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
}

test('retains run state and replays events after a disconnect', async () => {
  const registry = new RunRegistry();
  let release;
  const run = registry.start({ task: 'test', config: {}, mode: 1 }, async ws => {
    ws.send(JSON.stringify({ type: 'status', stage: 'architect', label: 'planning' }));
    await new Promise(resolve => { release = resolve; });
    ws.send(JSON.stringify({ type: 'done', passed: true }));
  });
  await new Promise(resolve => setImmediate(resolve));
  const first = socket();
  const unsubscribe = registry.subscribe(run, first);
  unsubscribe();
  release();
  await run.completion;
  const resumed = socket();
  registry.subscribe(run, resumed, 1);
  assert.equal(registry.get(run.id).status, 'completed');
  assert.ok(resumed.messages.some(message => message.type === 'done'));
  assert.ok(resumed.messages.some(message => message.type === 'run_state'));
});

test('bounds retained event count and rejects overlapping runs', async () => {
  const registry = new RunRegistry({ maxEventsPerRun: 2 });
  let release;
  const run = registry.start({ task: 'test', config: {}, mode: 1 }, async ws => {
    for (let index = 0; index < 4; index++) ws.send(JSON.stringify({ type: 'pty', data: String(index) }));
    await new Promise(resolve => { release = resolve; });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => registry.start({ task: 'second', config: {}, mode: 1 }, async () => {}), /already running/);
  assert.equal(run.events.length, 2);
  assert.equal(run.droppedEvents, 2);
  release();
  await run.completion;
});

test('RunRegistry persistence, crash recovery, index restoration, and subscribe replay', async () => {
  const tmpDir = join(os.tmpdir(), `triforce-test-runs-${randomUUID()}`);
  
  // 1. Start a registry and run a pipeline
  const registry1 = new RunRegistry({ runsDir: tmpDir });
  let release1;
  const run1 = registry1.start({ task: 'first task', config: {}, mode: 1 }, async ws => {
    ws.send(JSON.stringify({ type: 'status', stage: 'architect', label: 'running architect' }));
    await new Promise(resolve => { release1 = resolve; });
  });

  await new Promise(resolve => setImmediate(resolve));
  await registry1.flush(); // wait for disk writes

  // 2. Start a second run and complete it
  let release2;
  const registry2 = new RunRegistry({ runsDir: tmpDir });
  await registry2.load();

  const run2 = registry2.start({ task: 'second task', config: {}, mode: 1 }, async ws => {
    ws.send(JSON.stringify({ type: 'status', stage: 'developer', label: 'running dev' }));
    await new Promise(resolve => { release2 = resolve; });
    ws.send(JSON.stringify({ type: 'done', passed: true }));
  });

  await new Promise(resolve => setImmediate(resolve));
  release2();
  await run2.completion;
  await registry2.flush(); // wait for disk writes

  // 3. Instantiate a new registry instance from the same disk storage (simulating a crash restart)
  const registry3 = new RunRegistry({ runsDir: tmpDir });
  await registry3.load();

  // Assertions:
  const restoredRun1 = registry3.get(run1.id);
  assert.ok(restoredRun1, 'run1 should be restored');
  assert.equal(restoredRun1.status, 'failed', 'running run should be marked failed on boot');

  const restoredRun2 = registry3.get(run2.id);
  assert.ok(restoredRun2, 'run2 should be restored');
  assert.equal(restoredRun2.status, 'completed', 'completed run should remain completed');

  const list = registry3.list();
  assert.equal(list.length, 2);
  const snapshot1 = list.find(r => r.id === run1.id);
  const snapshot2 = list.find(r => r.id === run2.id);
  assert.equal(snapshot1.status, 'failed');
  assert.equal(snapshot2.status, 'completed');

  const clientSocket1 = socket();
  registry3.subscribe(restoredRun2, clientSocket1, 1);
  assert.ok(clientSocket1.messages.some(msg => msg.type === 'done' && msg.passed === true), 'should replay done event (eventId 2)');
  assert.ok(!clientSocket1.messages.some(msg => msg.type === 'status'), 'should NOT replay status event (eventId 1)');

  const clientSocket2 = socket();
  registry3.subscribe(restoredRun2, clientSocket2, 0);
  assert.ok(clientSocket2.messages.some(msg => msg.type === 'status' && msg.label === 'running dev'), 'should replay status event (eventId 1)');
  assert.ok(clientSocket2.messages.some(msg => msg.type === 'run_state' && msg.status === 'completed'), 'should replay completed run state event');

  // Clean up
  release1();
  await run1.completion;
  await registry1.flush();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('RunRegistry cancellation and active run release', async () => {
  const tmpDir = join(os.tmpdir(), `triforce-test-cancel-${randomUUID()}`);
  const registry = new RunRegistry({ runsDir: tmpDir });
  
  let abortSignalReceived;
  let pipelinePromiseReleased;
  const run = registry.start({ task: 'cancel task', config: {}, mode: 1 }, async (ws, signal) => {
    ws.send(JSON.stringify({ type: 'status', stage: 'architect', label: 'planning' }));
    abortSignalReceived = signal;
    await new Promise(resolve => { pipelinePromiseReleased = resolve; });
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registry.activeRun.id, run.id);
  assert.ok(abortSignalReceived);
  assert.equal(abortSignalReceived.aborted, false);

  const success = registry.cancel(run.id);
  assert.ok(success);
  assert.equal(abortSignalReceived.aborted, true);

  pipelinePromiseReleased();
  await run.completion;

  assert.equal(run.status, 'cancelled');
  assert.equal(registry.activeRun, null, 'active run should be cleared');

  // Verify that we can start a new run immediately
  const run2 = registry.start({ task: 'second task', config: {}, mode: 1 }, async () => {});
  assert.equal(registry.activeRun.id, run2.id);

  await run2.completion;
  await registry.flush();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
