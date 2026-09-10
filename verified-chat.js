// verified-chat.js — Mode 3 engine. A normal chat turn, but every answer is
// drafted by one CLI, critiqued by the others, then reconciled before it is
// shown. No sandbox, no workspace, no writes. Folder context is read-only text.

import { ask as defaultAsk } from './agent.js';
import { CLI_IDS } from './router.js';

export const CHAT_PROMPTS = {
  drafter:
    'You are the Drafter in Triforce verified chat. Answer the user\'s latest message directly and completely, using the conversation so far and any provided read-only project context. Be accurate; if you are unsure, say so. Plain prose, no preamble like "Sure" or "Here is".',
  checker:
    'You are a Checker in Triforce verified chat. You are given the user message, any project context, and another model\'s draft answer. Judge the draft for factual correctness, missing caveats, and anything you would answer differently. Begin your reply with exactly one line:\nASSESSMENT: AGREE   (the draft is correct and sufficient)\nor\nASSESSMENT: DISAGREE   (something is wrong, misleading, or materially incomplete)\nThen, on following lines, give specific corrections or additions. Be concise.',
  reconciler:
    'You are the Reconciler in Triforce verified chat. You are given the user message, the draft answer, and each checker\'s assessment. Produce the final answer the user should see. Fold in every correction you judge valid. If the checkers materially disagree and it cannot be resolved from the material, state the disagreement inline in one short parenthetical (e.g. "(2 of 3 models agree; dissent: ...)"). Output only the final answer.',
};

function cliAgentConfig(cliId) {
  return { provider: cliId, model: `${cliId}-default` };
}

function normalizePool(pool) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(pool) && pool.length ? pool : CLI_IDS) {
    if (CLI_IDS.includes(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out.length ? out : [...CLI_IDS];
}

function renderHistory(history) {
  if (!Array.isArray(history) || !history.length) return '';
  return history
    .filter(m => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n\n');
}

function parseAssessment(text) {
  const m = /ASSESSMENT:\s*(AGREE|DISAGREE)/i.exec(String(text || ''));
  return m ? m[1].toUpperCase() : 'UNCLEAR';
}

function tokensOf(usage) {
  if (!usage || usage.usageUnknown) return { tokens: 0, usageUnknown: true };
  return { tokens: (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0) };
}

/**
 * @param {string} message  the user's latest message
 * @param {object} [opts]
 * @param {Array<{role:'user'|'assistant', text:string}>} [opts.history]
 * @param {string} [opts.folderContext]  read-only project text (already size-budgeted)
 * @param {string[]} [opts.pool]          subset of CLI_IDS to use
 * @param {boolean} [opts.fast]           draft + 1 check + reconcile only
 * @param {AbortSignal} [opts.signal]
 * @param {typeof defaultAsk} [opts.ask]  injection point for tests
 * @param {{ record(cli:string, u:object):void, noteLimit(cli:string, ms:number):void }} [opts.ledger]
 * @param {string} [opts.conversationId]
 * @param {(event: object) => void} onEvent
 */
export async function runVerifiedChat(message, opts = {}, onEvent = () => {}) {
  const {
    history = [], folderContext = '', fast = false, signal,
    ask = defaultAsk, ledger = null, conversationId,
  } = opts;
  const pool = normalizePool(opts.pool);

  const checkAbort = () => {
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
  };

  const usageByCli = {};
  const noteUsage = (cli, usage) => {
    const t = tokensOf(usage);
    const prev = usageByCli[cli] || { inputTokens: 0, outputTokens: 0, calls: 0 };
    usageByCli[cli] = {
      inputTokens: prev.inputTokens + (Number(usage?.inputTokens) || 0),
      outputTokens: prev.outputTokens + (Number(usage?.outputTokens) || 0),
      calls: prev.calls + 1,
    };
    ledger?.record?.(cli, t);
    onEvent({ type: 'usage', usage: { ...usageByCli } });
  };

  const contextBlock = [
    renderHistory(history) && `CONVERSATION SO FAR:\n${renderHistory(history)}`,
    folderContext && `READ-ONLY PROJECT CONTEXT:\n${folderContext}`,
    `USER MESSAGE:\n${message}`,
  ].filter(Boolean).join('\n\n');

  // ── Draft ──
  checkAbort();
  onEvent({ type: 'status', stage: 'architect', label: 'Drafting answer' });
  const draftOrder = [...pool];
  let draft = null;
  let drafterCli = null;
  for (const cli of draftOrder) {
    try {
      const { text, usage } = await ask({ ...cliAgentConfig(cli), system: CHAT_PROMPTS.drafter, prompt: contextBlock, signal });
      draft = text;
      drafterCli = cli;
      noteUsage(cli, usage);
      break;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (err.status === 429 || err.code === 'NO_CAPACITY') ledger?.noteLimit?.(cli, null);
      onEvent({ type: 'chat_message', role: 'system', text: `Drafter ${cli} failed: ${err.message}` });
    }
  }
  if (draft === null) throw new Error('Every CLI in the pool failed to produce a draft');
  onEvent({ type: 'chat_message', role: 'draft', cli: drafterCli, text: draft });

  // ── Checkers ──
  const checkerPool = pool.filter(cli => cli !== drafterCli);
  const checkers = fast ? checkerPool.slice(0, 1) : checkerPool;
  const checks = [];
  for (const cli of checkers) {
    checkAbort();
    onEvent({ type: 'status', stage: 'reviewer', label: `Checking (${cli})` });
    try {
      const prompt = `${contextBlock}\n\nDRAFT ANSWER (from ${drafterCli}):\n${draft}`;
      const { text, usage } = await ask({ ...cliAgentConfig(cli), system: CHAT_PROMPTS.checker, prompt, signal });
      noteUsage(cli, usage);
      const assessment = parseAssessment(text);
      checks.push({ cli, assessment, text });
      onEvent({ type: 'chat_message', role: 'check', cli, assessment, text });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (err.status === 429 || err.code === 'NO_CAPACITY') ledger?.noteLimit?.(cli, null);
      checks.push({ cli, assessment: 'UNAVAILABLE', text: err.message });
      onEvent({ type: 'chat_message', role: 'system', text: `Checker ${cli} unavailable: ${err.message}` });
    }
  }

  const usable = checks.filter(c => c.assessment === 'AGREE' || c.assessment === 'DISAGREE');
  const agree = usable.filter(c => c.assessment === 'AGREE').length;
  const total = usable.length + 1; // + the drafter
  onEvent({
    type: 'deliberation',
    drafter: drafterCli,
    checkers: checks.map(c => ({ cli: c.cli, assessment: c.assessment })),
    agreement: `${agree + 1} of ${total}`,
    crossChecked: usable.length > 0,
  });

  // ── Reconcile ──
  checkAbort();
  if (usable.length === 0) {
    // Nothing cross-checked (single CLI, or all checkers unavailable): the draft
    // stands, flagged as unverified.
    const note = pool.length <= 1
      ? '(single model available — not cross-checked)'
      : '(checkers unavailable — not cross-checked)';
    const finalText = `${draft}\n\n${note}`;
    onEvent({ type: 'chat_message', role: 'final', cli: drafterCli, text: finalText });
    onEvent({ type: 'done', conversationId, passed: true, crossChecked: false });
    return { conversationId, drafter: drafterCli, final: finalText, crossChecked: false, usage: { ...usageByCli } };
  }

  onEvent({ type: 'status', stage: 'reviewer', label: 'Reconciling' });
  const reconcilerCli = pool.includes('agy-cli') ? 'agy-cli' : drafterCli;
  const reconcilePrompt = [
    contextBlock,
    `DRAFT ANSWER (from ${drafterCli}):\n${draft}`,
    ...checks.map(c => `CHECKER ${c.cli} [${c.assessment}]:\n${c.text}`),
  ].join('\n\n');
  let finalText;
  try {
    const { text, usage } = await ask({ ...cliAgentConfig(reconcilerCli), system: CHAT_PROMPTS.reconciler, prompt: reconcilePrompt, signal });
    noteUsage(reconcilerCli, usage);
    finalText = text;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Reconciler failed — fall back to the draft plus a disagreement summary.
    const dissent = checks.filter(c => c.assessment === 'DISAGREE').map(c => c.cli);
    finalText = dissent.length
      ? `${draft}\n\n(reconciler unavailable; ${dissent.join(', ')} flagged concerns — treat with caution)`
      : `${draft}\n\n(reconciler unavailable; ${agree} of ${usable.length} checkers agreed)`;
  }

  onEvent({ type: 'chat_message', role: 'final', cli: reconcilerCli, text: finalText });
  onEvent({ type: 'done', conversationId, passed: true, crossChecked: true });
  return { conversationId, drafter: drafterCli, reconciler: reconcilerCli, final: finalText, crossChecked: true, usage: { ...usageByCli } };
}
