import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { SubscriptionLedger } from '../subscription-ledger.js';

function clockLedger(extra = {}) {
  let t = 1_000_000;
  const led = new SubscriptionLedger({
    ledgerPath: join(os.tmpdir(), `triforce-ledger-test-${randomUUID()}.json`),
    now: () => t,
    ...extra,
  });
  return { led, advance: ms => { t += ms; }, at: () => t };
}

test('records calls and reports decreasing headroom', () => {
  const { led } = clockLedger({ shortLimit: 10, longLimit: 100 });
  assert.equal(led.headroom('claude-cli'), 1);
  for (let i = 0; i < 5; i++) led.record('claude-cli', { tokens: 100 });
  assert.equal(led.callsInWindow('claude-cli', 5 * 60 * 1000), 5);
  assert.ok(Math.abs(led.headroom('claude-cli') - 0.5) < 1e-9);
  assert.equal(led.snapshot()['claude-cli'].tokens, 500);
});

test('noteLimit puts a CLI into cooldown that expires on the clock', () => {
  const { led, advance } = clockLedger();
  led.noteLimit('codex-cli', 30_000);
  assert.equal(led.isCooling('codex-cli'), true);
  assert.equal(led.headroom('codex-cli'), 0);
  assert.equal(led.cooldownRemaining('codex-cli'), 30_000);
  advance(29_999);
  assert.equal(led.isCooling('codex-cli'), true);
  advance(2);
  assert.equal(led.isCooling('codex-cli'), false);
});

test('noteLimit without a retry hint uses the default cooldown and never shrinks an existing one', () => {
  const { led, advance } = clockLedger();
  led.noteLimit('agy-cli', null);
  assert.equal(led.cooldownRemaining('agy-cli'), 60_000);
  led.noteLimit('agy-cli', 5_000); // shorter — must not shorten the window
  assert.equal(led.cooldownRemaining('agy-cli'), 60_000);
  advance(1_000);
  led.noteLimit('agy-cli', 120_000); // longer — extends
  assert.equal(led.cooldownRemaining('agy-cli'), 120_000);
});

test('usageUnknown calls still count toward call-rate headroom but add no tokens', () => {
  const { led } = clockLedger({ shortLimit: 4, longLimit: 100 });
  led.record('agy-cli', { usageUnknown: true });
  led.record('agy-cli', { usageUnknown: true });
  assert.equal(led.snapshot()['agy-cli'].tokens, 0);
  assert.equal(led.callsInWindow('agy-cli', 5 * 60 * 1000), 2);
  assert.ok(Math.abs(led.headroom('agy-cli') - 0.5) < 1e-9);
});

test('old calls fall out of the 24h window', () => {
  const { led, advance } = clockLedger({ shortLimit: 10, longLimit: 10 });
  led.record('claude-cli');
  advance(25 * 60 * 60 * 1000);
  led.record('claude-cli');
  assert.equal(led.callsInWindow('claude-cli', 24 * 60 * 60 * 1000), 1);
});

test('state round-trips through disk atomically', async () => {
  const path = join(os.tmpdir(), `triforce-ledger-persist-${randomUUID()}.json`);
  const a = new SubscriptionLedger({ ledgerPath: path });
  a.record('claude-cli', { tokens: 42 });
  a.noteLimit('codex-cli', 45_000);
  await a.flush();

  const raw = JSON.parse(await fs.readFile(path, 'utf8'));
  assert.equal(raw['claude-cli'].calls.length, 1);
  assert.ok(raw['codex-cli'].cooldownUntil > Date.now());

  const b = new SubscriptionLedger({ ledgerPath: path });
  assert.equal(b.snapshot()['claude-cli'].tokens, 42);
  assert.equal(b.isCooling('codex-cli'), true);
  await fs.rm(path, { force: true });
});

test('a corrupt ledger file does not throw', async () => {
  const path = join(os.tmpdir(), `triforce-ledger-corrupt-${randomUUID()}.json`);
  await fs.writeFile(path, '{ not json');
  const led = new SubscriptionLedger({ ledgerPath: path });
  assert.equal(led.headroom('claude-cli'), 1);
  await fs.rm(path, { force: true });
});
