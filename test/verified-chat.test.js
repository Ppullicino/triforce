import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerifiedChat, CHAT_PROMPTS } from '../verified-chat.js';

// A scripted `ask` that answers based on which chat role's system prompt it sees.
function scriptedAsk(script = {}) {
  const calls = [];
  const ask = async ({ provider, system, prompt, signal }) => {
    if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    calls.push({ provider, system, prompt });
    let role = 'other';
    if (system === CHAT_PROMPTS.drafter) role = 'draft';
    else if (system === CHAT_PROMPTS.checker) role = 'check';
    else if (system === CHAT_PROMPTS.reconciler) role = 'reconcile';
    const key = `${provider}:${role}`;
    const hit = script[key] ?? script[role];
    if (typeof hit === 'function') return hit({ provider, prompt });
    if (hit instanceof Error) throw hit;
    if (hit && typeof hit === 'object' && typeof hit.text === 'string') {
      return { usage: { inputTokens: 10, outputTokens: 5 }, ...hit };
    }
    return { text: hit ?? `${provider} ${role} answer`, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  return { ask, calls };
}

function collect() {
  const events = [];
  return { onEvent: e => events.push(e), events };
}

test('draft -> all checkers -> reconciled, with a deliberation event', async () => {
  const { ask, calls } = scriptedAsk({
    'claude-cli:draft': { text: 'DRAFT from claude', usage: { inputTokens: 20, outputTokens: 8 } },
    'codex-cli:check': { text: 'ASSESSMENT: AGREE\nlooks fine', usage: { inputTokens: 5, outputTokens: 2 } },
    'agy-cli:check': { text: 'ASSESSMENT: DISAGREE\nmissing an edge case', usage: { inputTokens: 5, outputTokens: 2 } },
    'agy-cli:reconcile': { text: 'FINAL reconciled answer', usage: { inputTokens: 30, outputTokens: 12 } },
  });
  const { onEvent, events } = collect();
  const result = await runVerifiedChat('How do I do X?', { ask, pool: ['claude-cli', 'codex-cli', 'agy-cli'] }, onEvent);

  const chat = events.filter(e => e.type === 'chat_message');
  assert.equal(chat.find(e => e.role === 'draft').cli, 'claude-cli');
  assert.deepEqual(chat.filter(e => e.role === 'check').map(e => e.cli), ['codex-cli', 'agy-cli']);
  assert.equal(chat.find(e => e.role === 'final').text, 'FINAL reconciled answer');

  const delib = events.find(e => e.type === 'deliberation');
  assert.equal(delib.drafter, 'claude-cli');
  assert.equal(delib.crossChecked, true);
  assert.equal(delib.agreement, '2 of 3'); // drafter + 1 agreeing checker of 3 opinions

  assert.equal(result.crossChecked, true);
  assert.equal(result.reconciler, 'agy-cli');
  assert.ok(events.some(e => e.type === 'done' && e.passed === true));
  // drafter + 2 checkers + reconciler
  assert.equal(calls.length, 4);
});

test('fast mode uses a single checker', async () => {
  const { ask, calls } = scriptedAsk({ check: 'ASSESSMENT: AGREE\nok', reconcile: 'FINAL' });
  const { onEvent, events } = collect();
  await runVerifiedChat('q', { ask, fast: true, pool: ['claude-cli', 'codex-cli', 'agy-cli'] }, onEvent);
  assert.equal(events.filter(e => e.type === 'chat_message' && e.role === 'check').length, 1);
  assert.equal(calls.length, 3); // draft + 1 check + reconcile
});

test('single-CLI pool degrades to the draft with an unverified note and no reconcile call', async () => {
  const { ask, calls } = scriptedAsk({ 'claude-cli:draft': 'only answer' });
  const { onEvent, events } = collect();
  const result = await runVerifiedChat('q', { ask, pool: ['claude-cli'] }, onEvent);
  assert.equal(calls.length, 1);
  assert.equal(result.crossChecked, false);
  const final = events.find(e => e.type === 'chat_message' && e.role === 'final');
  assert.match(final.text, /only answer/);
  assert.match(final.text, /not cross-checked/);
  assert.equal(events.find(e => e.type === 'deliberation').crossChecked, false);
});

test('a failing checker is tolerated and reported', async () => {
  const { ask } = scriptedAsk({
    'claude-cli:draft': 'd',
    'codex-cli:check': Object.assign(new Error('codex down'), { status: 500 }),
    'agy-cli:check': 'ASSESSMENT: AGREE\nok',
    'agy-cli:reconcile': 'FINAL',
  });
  const { onEvent, events } = collect();
  const noted = [];
  const result = await runVerifiedChat('q', {
    ask, pool: ['claude-cli', 'codex-cli', 'agy-cli'],
    ledger: { record() {}, noteLimit: (cli, ms) => noted.push([cli, ms]) },
  }, onEvent);
  assert.ok(events.some(e => e.type === 'chat_message' && e.role === 'system' && /codex-cli unavailable/.test(e.text)));
  assert.equal(result.crossChecked, true); // agy still checked
  assert.deepEqual(noted, []); // 500 is not a capacity signal
});

test('a 429 from the drafter records a cooldown and fails over', async () => {
  const { ask } = scriptedAsk({
    'claude-cli:draft': Object.assign(new Error('rate limited'), { status: 429 }),
    'codex-cli:draft': 'codex draft',
    'agy-cli:check': 'ASSESSMENT: AGREE\nok',
    'agy-cli:reconcile': 'FINAL',
  });
  const noted = [];
  const { onEvent, events } = collect();
  const result = await runVerifiedChat('q', {
    ask, pool: ['claude-cli', 'codex-cli', 'agy-cli'],
    ledger: { record() {}, noteLimit: (cli) => noted.push(cli) },
  }, onEvent);
  assert.equal(result.drafter, 'codex-cli');
  assert.deepEqual(noted, ['claude-cli']);
  assert.equal(events.find(e => e.type === 'chat_message' && e.role === 'draft').cli, 'codex-cli');
});

test('every CLI failing to draft throws', async () => {
  const { ask } = scriptedAsk({ draft: new Error('all down') });
  const { onEvent } = collect();
  await assert.rejects(
    () => runVerifiedChat('q', { ask, pool: ['claude-cli', 'codex-cli'] }, onEvent),
    /failed to produce a draft/,
  );
});

test('abort during checks propagates AbortError', async () => {
  const controller = new AbortController();
  const ask = async ({ system }) => {
    if (system === CHAT_PROMPTS.drafter) { controller.abort(); return { text: 'd', usage: {} }; }
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  };
  const { onEvent } = collect();
  await assert.rejects(
    () => runVerifiedChat('q', { ask, signal: controller.signal, pool: ['claude-cli', 'codex-cli'] }, onEvent),
    e => e.name === 'AbortError',
  );
});

test('usage events carry a per-CLI shape and the ledger is fed', async () => {
  const recorded = [];
  const { ask } = scriptedAsk({ draft: 'd', check: 'ASSESSMENT: AGREE', reconcile: 'F' });
  const { onEvent, events } = collect();
  await runVerifiedChat('q', {
    ask, pool: ['claude-cli', 'codex-cli', 'agy-cli'],
    ledger: { record: (cli, u) => recorded.push([cli, u.tokens]), noteLimit() {} },
  }, onEvent);
  const lastUsage = events.filter(e => e.type === 'usage').at(-1).usage;
  assert.ok('claude-cli' in lastUsage);
  assert.equal(typeof lastUsage['claude-cli'].calls, 'number');
  assert.ok(recorded.length >= 3);
});
