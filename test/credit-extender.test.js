import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCreditExtender } from '../credit-extender.js';

function fakeLedger(cooling = []) {
  const cool = new Set(cooling);
  const noted = [];
  return {
    noted,
    record() {},
    noteLimit: (cli, ms) => { noted.push([cli, ms]); cool.add(cli); },
    isCooling: cli => cool.has(cli),
    cooldownRemaining: () => 1000,
  };
}
function collect() { const events = []; return { onEvent: e => events.push(e), events }; }
function e429(msg = 'rate limit') { return Object.assign(new Error(msg), { status: 429 }); }

test('Q&A task fans out across CLIs, tolerates a 429, and reconciles', async () => {
  const ledger = fakeLedger();
  const ask = async ({ provider, system }) => {
    if (/reconcile|single best answer/i.test(system)) return { text: 'MERGED ANSWER', usage: { inputTokens: 8, outputTokens: 4 } };
    if (provider === 'codex-cli') throw e429();
    return { text: `${provider} says hi`, usage: { inputTokens: 5, outputTokens: 3 } };
  };
  const { onEvent, events } = collect();
  const res = await runCreditExtender('What is a closure, briefly?', { ask, ledger, deliberate: true, pool: ['claude-cli', 'codex-cli', 'agy-cli'] }, onEvent);

  assert.equal(res.kind, 'answer');
  assert.equal(res.final, 'MERGED ANSWER');
  assert.ok(events.some(e => e.type === 'route' && e.step === 'deliberate'));
  assert.ok(events.some(e => e.type === 'route' && e.step === 'reconcile'));
  assert.ok(events.some(e => e.type === 'deliberation' && e.crossChecked === true));
  assert.equal(events.find(e => e.type === 'chat_message' && e.role === 'final').text, 'MERGED ANSWER');
  assert.ok(events.some(e => e.type === 'done' && e.passed === true));
  assert.deepEqual(ledger.noted.map(n => n[0]), ['codex-cli']);
});

test('a pool where every CLI is cooling raises NoCapacityError', async () => {
  const ledger = fakeLedger(['claude-cli', 'codex-cli', 'agy-cli']);
  await assert.rejects(
    () => runCreditExtender('why is the sky blue', { ask: async () => ({ text: 'x', usage: {} }), ledger, deliberate: true }, () => {}),
    /No CLI|NoCapacity|cooling/i,
  );
});

test('build task routes the coder step and fails over past a 429 (systemd)', async (t) => {
  // needs the workspace sandbox
  let calls = 0;
  const workspacesDir = await mkdtemp(join(tmpdir(), 'triforce-credit-'));
  const ledger = fakeLedger();
  const MANIFEST = JSON.stringify({
    files: [
      { path: 'index.js', content: 'export const ok = true;\n' },
      { path: 'test.js', content: "import { ok } from './index.js'; if (!ok) process.exit(1);\n" },
    ],
    testFile: 'test.js',
  });
  const ask = async ({ provider, system }) => {
    if (/reviewing another agent/i.test(system)) return { text: 'VERDICT: PASS\nFEEDBACK: ok', usage: { inputTokens: 4, outputTokens: 2 } };
    // coder step
    calls++;
    if (calls === 1) throw e429('usage limit reached'); // first routed CLI is rate-limited
    return { text: MANIFEST, usage: { inputTokens: 10, outputTokens: 20 } };
  };
  const { onEvent, events } = collect();
  try {
    const res = await runCreditExtender('Edit the project so index exports ok', {
      ask, ledger, deliberate: false, pool: ['codex-cli', 'claude-cli', 'agy-cli'],
      workspacesDir, packageRoot: join(import.meta.dirname, '..'), dependencyRoot: join(import.meta.dirname, '..', 'node_modules'),
    }, onEvent);
    assert.equal(res.kind, 'build');
    assert.equal(res.passed, true);
    const routeEvents = events.filter(e => e.type === 'route' && e.step === 'coder');
    assert.ok(routeEvents.some(e => e.failed), 'emitted a failover route event');
    assert.ok(ledger.noted.length >= 1, 'ledger recorded the capacity signal');
    assert.ok(events.some(e => e.type === 'sandbox'));
    assert.ok(events.some(e => e.type === 'done' && e.passed === true));
  } finally {
    await rm(workspacesDir, { recursive: true, force: true });
  }
});
