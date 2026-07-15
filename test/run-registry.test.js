import test from 'node:test';
import assert from 'node:assert/strict';
import { RunRegistry } from '../run-registry.js';

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
