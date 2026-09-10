// subscription-ledger.js — per-CLI rolling usage, cooldown timers, and
// 429 / usage-limit backoff for Mode 2 routing and the UI headroom bar.
// Persisted as JSON under TRIFORCE_RUNS_DIR (atomic write, 0600).

import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { CLI_IDS } from './router.js';

const SHORT_WINDOW_MS = 5 * 60 * 1000;
const LONG_WINDOW_MS = 24 * 60 * 60 * 1000;

// Subscription quotas are opaque, so headroom is a conservative call-rate proxy.
// Override via env for tighter or looser pacing.
const SHORT_LIMIT = Number(process.env.TRIFORCE_LEDGER_SHORT_LIMIT) || 25;   // calls / 5 min
const LONG_LIMIT = Number(process.env.TRIFORCE_LEDGER_LONG_LIMIT) || 400;    // calls / 24 h
const DEFAULT_COOLDOWN_MS = Number(process.env.TRIFORCE_LEDGER_COOLDOWN_MS) || 60_000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;

function emptyCli() {
  return { calls: [], tokens: 0, cooldownUntil: 0, lastLimitAt: 0 };
}

export class SubscriptionLedger {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dir]         directory for ledger.json (default: TRIFORCE_RUNS_DIR)
   * @param {string} [opts.ledgerPath]  explicit file path (overrides dir)
   * @param {() => number} [opts.now]   clock injection for tests
   * @param {number} [opts.shortLimit]
   * @param {number} [opts.longLimit]
   */
  constructor({ dir, ledgerPath, now = () => Date.now(), shortLimit = SHORT_LIMIT, longLimit = LONG_LIMIT } = {}) {
    this.now = now;
    this.shortLimit = shortLimit;
    this.longLimit = longLimit;
    this.state = Object.fromEntries(CLI_IDS.map(id => [id, emptyCli()]));
    this.writeQueue = Promise.resolve();

    if (ledgerPath) {
      this.path = ledgerPath;
    } else {
      const base = dir
        || process.env.TRIFORCE_RUNS_DIR
        || (process.env.NODE_ENV === 'test'
          ? join(os.tmpdir(), `triforce-test-ledger-${randomUUID()}`)
          : join(os.homedir(), '.local/share/triforce/runs'));
      this.path = join(base, 'ledger.json');
    }
    try { mkdirSync(dirname(this.path), { recursive: true }); } catch { /* best effort */ }
    this._loadSync();
  }

  _loadSync() {
    try {
      if (!existsSync(this.path)) return;
      const saved = JSON.parse(readFileSync(this.path, 'utf8'));
      for (const id of CLI_IDS) {
        const entry = saved?.[id];
        if (!entry) continue;
        this.state[id] = {
          ...emptyCli(),
          ...entry,
          calls: Array.isArray(entry.calls) ? entry.calls.filter(c => typeof c?.t === 'number') : [],
        };
      }
    } catch {
      // corrupt ledger — start fresh, don't crash the server
      this.state = Object.fromEntries(CLI_IDS.map(id => [id, emptyCli()]));
    }
  }

  _cli(id) {
    if (!this.state[id]) this.state[id] = emptyCli();
    return this.state[id];
  }

  _prune(id, nowMs) {
    const cli = this._cli(id);
    const cutoff = nowMs - LONG_WINDOW_MS;
    if (cli.calls.length && cli.calls[0].t < cutoff) {
      cli.calls = cli.calls.filter(c => c.t >= cutoff);
    }
  }

  /**
   * Record one completed CLI call.
   * @param {string} id
   * @param {{ tokens?: number, usageUnknown?: boolean }} [usage]
   */
  record(id, usage = {}) {
    if (!CLI_IDS.includes(id)) return;
    const nowMs = this.now();
    const cli = this._cli(id);
    const tokens = usage.usageUnknown ? 0 : Math.max(0, Number(usage.tokens) || 0);
    cli.calls.push({ t: nowMs, tokens });
    cli.tokens += tokens;
    this._prune(id, nowMs);
    this._persist();
  }

  /**
   * Note a capacity signal (429 / usage limit). Puts the CLI into cooldown.
   * @param {string} id
   * @param {number|null} [retryAfterMs] from agent.js getRetryAfterMs(); falls back to a default
   */
  noteLimit(id, retryAfterMs) {
    if (!CLI_IDS.includes(id)) return;
    const nowMs = this.now();
    const cli = this._cli(id);
    const wait = Math.min(MAX_COOLDOWN_MS, Number(retryAfterMs) > 0 ? Number(retryAfterMs) : DEFAULT_COOLDOWN_MS);
    cli.cooldownUntil = Math.max(cli.cooldownUntil, nowMs + wait);
    cli.lastLimitAt = nowMs;
    this._persist();
  }

  /** Manually clear a cooldown (e.g. operator override). */
  clearCooldown(id) {
    const cli = this._cli(id);
    cli.cooldownUntil = 0;
    this._persist();
  }

  isCooling(id) {
    return this.now() < (this._cli(id).cooldownUntil || 0);
  }

  cooldownRemaining(id) {
    return Math.max(0, (this._cli(id).cooldownUntil || 0) - this.now());
  }

  callsInWindow(id, windowMs) {
    const cutoff = this.now() - windowMs;
    return this._cli(id).calls.reduce((n, c) => n + (c.t >= cutoff ? 1 : 0), 0);
  }

  /** 0..1 remaining capacity for the UI bar. Cooling CLIs report 0. */
  headroom(id) {
    if (this.isCooling(id)) return 0;
    const shortUse = this.callsInWindow(id, SHORT_WINDOW_MS) / this.shortLimit;
    const longUse = this.callsInWindow(id, LONG_WINDOW_MS) / this.longLimit;
    return Math.max(0, Math.min(1, 1 - Math.max(shortUse, longUse)));
  }

  /** Per-CLI view for the client. */
  snapshot() {
    const out = {};
    for (const id of CLI_IDS) {
      out[id] = {
        headroom: this.headroom(id),
        cooling: this.isCooling(id),
        cooldownRemainingMs: this.cooldownRemaining(id),
        callsShortWindow: this.callsInWindow(id, SHORT_WINDOW_MS),
        callsLongWindow: this.callsInWindow(id, LONG_WINDOW_MS),
        tokens: this._cli(id).tokens,
        lastLimitAt: this._cli(id).lastLimitAt || null,
      };
    }
    return out;
  }

  _persist() {
    if (!this.path) return this.writeQueue;
    const data = JSON.stringify(this.state);
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.path}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, data, { mode: 0o600 });
        await fs.rename(tmp, this.path);
      } catch {
        try { await fs.unlink(tmp); } catch { /* ignore */ }
      }
    });
    return this.writeQueue;
  }

  async flush() {
    await this.writeQueue;
  }
}
