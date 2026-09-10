// router.js — Mode 2 (credit extender) task-fit + capacity-aware CLI selection.
// Pure module: no I/O, no side effects. The subscription ledger is passed in.

/** The only model access Triforce has. */
export const CLI_IDS = ['claude-cli', 'codex-cli', 'agy-cli'];

export class NoCapacityError extends Error {
  constructor(message = 'All CLIs are in cooldown') {
    super(message);
    this.name = 'NoCapacityError';
    this.code = 'NO_CAPACITY';
  }
}

/**
 * task type -> ordered CLI preference (index 0 = best fit). Overridable from
 * models.config.json `router` (see loadRouterHints).
 */
export const DEFAULT_ROUTER_HINTS = Object.freeze({
  'code-edit':  ['codex-cli', 'claude-cli', 'agy-cli'],
  'code-gen':   ['codex-cli', 'claude-cli', 'agy-cli'],
  'review':     ['claude-cli', 'agy-cli', 'codex-cli'],
  'reasoning':  ['claude-cli', 'codex-cli', 'agy-cli'],
  'quick':      ['agy-cli', 'claude-cli', 'codex-cli'],
  'default':    ['claude-cli', 'codex-cli', 'agy-cli'],
});

// Ordered: first match wins. Keep specific patterns before broad ones.
const CLASSIFIERS = [
  ['code-edit',  /\b(refactor|patch|rename|fix the|modify|edit the|change the code|update the code)\b/i],
  ['review',     /\b(review|audit|assess|critique|is this correct|find the bug|check whether)\b/i],
  ['quick',     /\b(what is|what's|define|briefly|tl;?dr|one[- ]?liner|quick question|in one sentence)\b/i],
  ['code-gen',   /\b(write|implement|create|build|generate|scaffold|add a (function|module|test)|new module)\b/i],
  ['reasoning',  /\b(why|design|architect|trade[- ]?off|compare|analy[sz]e|reason about|think through|plan)\b/i],
];

/** @param {string} text @returns {string} task type key */
export function classifyTask(text) {
  const s = typeof text === 'string' ? text : '';
  for (const [type, re] of CLASSIFIERS) if (re.test(s)) return type;
  return 'default';
}

/**
 * Merge a partial override table onto the defaults. Only arrays of valid CLI ids
 * are accepted; anything else is ignored.
 * @param {{ router?: Record<string, unknown> } | null | undefined} modelsConfig
 */
export function loadRouterHints(modelsConfig) {
  const out = { ...DEFAULT_ROUTER_HINTS };
  const raw = modelsConfig?.router;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (Array.isArray(value) && value.length && value.every(v => CLI_IDS.includes(v))) {
        out[key] = [...value];
      }
    }
  }
  return out;
}

function orderedCandidates({ taskType, task, pool, hints, exclude }) {
  const type = taskType || classifyTask(task);
  const allowed = new Set(pool && pool.length ? pool.filter(c => CLI_IDS.includes(c)) : CLI_IDS);
  const skip = new Set(exclude || []);
  const table = { ...DEFAULT_ROUTER_HINTS, ...(hints || {}) };
  const pref = table[type] || table.default || DEFAULT_ROUTER_HINTS.default;
  const ordered = [
    ...pref.filter(c => allowed.has(c) && !skip.has(c)),
    ...[...allowed].filter(c => !skip.has(c) && !pref.includes(c)),
  ];
  return { type, ordered };
}

/**
 * Pick one CLI for a step: best task fit that is not in ledger cooldown.
 * @param {object} opts
 * @param {string} [opts.taskType]              explicit task type (else classify `task`)
 * @param {string} [opts.task]                  raw task text
 * @param {{ isCooling(cli:string): boolean }} [opts.ledger]
 * @param {string[]} [opts.pool]                restrict to this subset
 * @param {Record<string,string[]>} [opts.hints]  override table
 * @param {string[]} [opts.exclude]             CLIs to skip this pick (e.g. one that just 429'd)
 * @returns {string} chosen CLI id
 * @throws {NoCapacityError} when every candidate is cooling or the pool is empty
 */
export function pickCli(opts = {}) {
  const { ledger } = opts;
  const { type, ordered } = orderedCandidates(opts);
  if (!ordered.length) throw new NoCapacityError(`No CLI in pool for task type "${type}"`);
  const free = ordered.find(cli => !ledger || !ledger.isCooling(cli));
  if (!free) throw new NoCapacityError(`All CLIs cooling for task type "${type}": ${ordered.join(', ')}`);
  return free;
}

/**
 * Pick up to `n` CLIs for deliberation fan-out, preferring ones with capacity.
 * Falls back to cooling CLIs only if nothing else is available.
 * @returns {string[]} 1..n CLI ids
 * @throws {NoCapacityError} when the pool resolves to nothing
 */
export function pickPool(opts = {}) {
  const { ledger, n = 3 } = opts;
  const { type, ordered } = orderedCandidates(opts);
  if (!ordered.length) throw new NoCapacityError(`No CLIs available for deliberation ("${type}")`);
  const free = ordered.filter(cli => !ledger || !ledger.isCooling(cli));
  const chosen = (free.length ? free : ordered).slice(0, Math.max(1, n));
  return chosen;
}
