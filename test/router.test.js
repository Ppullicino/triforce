import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLI_IDS, NoCapacityError, classifyTask, loadRouterHints, pickCli, pickPool, DEFAULT_ROUTER_HINTS,
} from '../router.js';

const noCooldown = { isCooling: () => false };
function coolingSet(...ids) {
  const set = new Set(ids);
  return { isCooling: id => set.has(id) };
}

test('classifyTask maps text to a task type', () => {
  assert.equal(classifyTask('Refactor the parser to use streaming'), 'code-edit');
  assert.equal(classifyTask('Review this diff for correctness'), 'review');
  assert.equal(classifyTask('What is a monad, briefly?'), 'quick');
  assert.equal(classifyTask('Implement a new module for retries'), 'code-gen');
  assert.equal(classifyTask('Why does this design scale badly?'), 'reasoning');
  assert.equal(classifyTask('random unclassifiable text'), 'default');
  assert.equal(classifyTask(undefined), 'default');
});

test('pickCli returns the best task-fit CLI with capacity', () => {
  assert.equal(pickCli({ task: 'Refactor the parser', ledger: noCooldown }), 'codex-cli');
  assert.equal(pickCli({ taskType: 'reasoning', ledger: noCooldown }), 'claude-cli');
  assert.equal(pickCli({ taskType: 'quick', ledger: noCooldown }), 'agy-cli');
});

test('pickCli fails over past a cooling CLI', () => {
  assert.equal(
    pickCli({ taskType: 'code-edit', ledger: coolingSet('codex-cli') }),
    'claude-cli',
  );
  assert.equal(
    pickCli({ taskType: 'code-edit', ledger: coolingSet('codex-cli', 'claude-cli') }),
    'agy-cli',
  );
});

test('pickCli honours pool and exclude', () => {
  assert.equal(pickCli({ taskType: 'reasoning', pool: ['codex-cli', 'agy-cli'], ledger: noCooldown }), 'codex-cli');
  assert.equal(pickCli({ taskType: 'reasoning', exclude: ['claude-cli'], ledger: noCooldown }), 'codex-cli');
});

test('pickCli throws NoCapacityError when every candidate is cooling', () => {
  assert.throws(
    () => pickCli({ taskType: 'code-edit', ledger: coolingSet(...CLI_IDS) }),
    NoCapacityError,
  );
  assert.throws(
    () => pickCli({ taskType: 'code-edit', pool: ['agy-cli'], ledger: coolingSet('agy-cli') }),
    /All CLIs cooling/,
  );
});

test('pickPool returns up to n capacity-having CLIs, preferring fit order', () => {
  assert.deepEqual(pickPool({ taskType: 'code-edit', n: 2, ledger: noCooldown }), ['codex-cli', 'claude-cli']);
  assert.deepEqual(pickPool({ taskType: 'reasoning', n: 3, ledger: noCooldown }), ['claude-cli', 'codex-cli', 'agy-cli']);
  // cooling CLIs are dropped when others remain
  assert.deepEqual(pickPool({ taskType: 'reasoning', n: 3, ledger: coolingSet('claude-cli') }), ['codex-cli', 'agy-cli']);
  // falls back to cooling CLIs only if nothing else is available
  assert.deepEqual(pickPool({ taskType: 'reasoning', n: 1, ledger: coolingSet(...CLI_IDS) }), ['claude-cli']);
});

test('loadRouterHints merges valid overrides and ignores junk', () => {
  const hints = loadRouterHints({ router: { 'code-edit': ['agy-cli', 'claude-cli'], bogus: ['nope'], other: 'x' } });
  assert.deepEqual(hints['code-edit'], ['agy-cli', 'claude-cli']);
  assert.deepEqual(hints.reasoning, DEFAULT_ROUTER_HINTS.reasoning);
  assert.equal(hints.bogus, undefined);
  assert.deepEqual(loadRouterHints(null).default, DEFAULT_ROUTER_HINTS.default);
});

test('pickCli applies an override table', () => {
  const hints = loadRouterHints({ router: { 'code-edit': ['agy-cli', 'claude-cli', 'codex-cli'] } });
  assert.equal(pickCli({ taskType: 'code-edit', hints, ledger: noCooldown }), 'agy-cli');
});
