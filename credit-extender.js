// credit-extender.js — Mode 2 engine. Roleless: a router picks the best CLI per
// step, spreads load across the three subscriptions, fails over on 429 /
// usage-limit signals, and (for questions) fans out to several CLIs and
// reconciles. Code still runs in the sandbox; file changes go through the
// workspace-copy + apply flow, exactly like Mode 1.

import { ask as defaultAsk } from './agent.js';
import { getErrorStatus, getRetryAfterMs } from './agent.js';
import { CLI_IDS, NoCapacityError, classifyTask, loadRouterHints, pickCli, pickPool } from './router.js';
import { createWorkspace, createWorkspaceFromDir, parseWorkspaceManifest, runWorkspaceTest, getWorkspaceDiff } from './workspace.js';
import { parseVerdict, stripCodeFences } from './pipeline.js';

const CODER_PROMPT =
  'You are a coding agent. Implement the task by returning ONLY one valid JSON object: {"files":[{"path":"relative/path","content":"complete file contents"}],"testFile":"path/to/test.js"}. When editing an existing project already present, return every file you change or add with full contents. Paths are relative, no .., .git or node_modules. The testFile runs under Node in-process and spawns no child processes. No markdown fences, no prose outside the JSON.';
const REVIEW_PROMPT =
  'You are reviewing another agent\'s code against the task, the file manifest, the isolated test output and the diff. Output exactly:\nVERDICT: [PASS or FAIL]\nFEEDBACK: [specific fixes if FAIL]';
const ANSWER_PROMPT =
  'Answer the user\'s question directly and accurately using any provided context. If unsure, say so. Plain prose, no preamble.';
const RECONCILE_PROMPT =
  'You are given a question and several models\' answers. Produce the single best answer, folding in every correct point and noting any unresolved disagreement in one short parenthetical. Output only the answer.';

function cliAgentConfig(cliId) {
  return { provider: cliId, model: `${cliId}-default` };
}

function normalizePool(pool) {
  const out = [];
  for (const id of Array.isArray(pool) && pool.length ? pool : CLI_IDS) {
    if (CLI_IDS.includes(id) && !out.includes(id)) out.push(id);
  }
  return out.length ? out : [...CLI_IDS];
}

function isCapacitySignal(err) {
  return getErrorStatus(err) === 429 || err?.code === 'NO_CAPACITY' || /usage limit/i.test(err?.message || '');
}

/**
 * @param {string} task
 * @param {object} [opts]
 * @param {string[]} [opts.pool]
 * @param {boolean} [opts.deliberate]  force deliberation on/off (default: on for questions)
 * @param {object} [opts.routerHints]  from models.config.json
 * @param {AbortSignal} [opts.signal]
 * @param {typeof defaultAsk} [opts.ask]
 * @param {{ record(cli,u):void, noteLimit(cli,ms):void, isCooling(cli):boolean }} [opts.ledger]
 * @param {string} [opts.workspacesDir]
 * @param {string} [opts.packageRoot]
 * @param {string} [opts.dependencyRoot]
 * @param {string} [opts.workingDir]
 * @param {{id,directory,testFile,files}} [opts.seededWorkspace]
 * @param {(event: object) => void} onEvent
 */
export async function runCreditExtender(task, opts = {}, onEvent = () => {}) {
  const {
    signal, ask = defaultAsk, ledger = null,
    workspacesDir, packageRoot, dependencyRoot, workingDir, seededWorkspace,
  } = opts;
  const pool = normalizePool(opts.pool);
  const hints = loadRouterHints({ router: opts.routerHints });
  const taskType = classifyTask(task);

  const checkAbort = () => {
    if (signal?.aborted) { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; }
  };

  const usageByCli = {};
  const noteUsage = (cli, usage) => {
    const prev = usageByCli[cli] || { inputTokens: 0, outputTokens: 0, calls: 0 };
    usageByCli[cli] = {
      inputTokens: prev.inputTokens + (Number(usage?.inputTokens) || 0),
      outputTokens: prev.outputTokens + (Number(usage?.outputTokens) || 0),
      calls: prev.calls + 1,
    };
    ledger?.record?.(cli, usage?.usageUnknown ? { usageUnknown: true } : { tokens: (Number(usage?.inputTokens) || 0) + (Number(usage?.outputTokens) || 0) });
    onEvent({ type: 'usage', usage: { ...usageByCli } });
  };

  /** Route a step to a CLI, calling it; fail over on capacity signals. */
  async function routedAsk(step, { system, prompt, stepType = taskType } = {}) {
    const tried = [];
    for (let attempt = 0; attempt < pool.length; attempt++) {
      let cli;
      try {
        cli = pickCli({ taskType: stepType, pool, hints, ledger, exclude: tried });
      } catch (err) {
        if (err instanceof NoCapacityError) throw err;
        throw err;
      }
      onEvent({ type: 'route', step, cli, reason: `${stepType}${tried.length ? ` · failover from ${tried.join(', ')}` : ''}` });
      try {
        const res = await ask({ ...cliAgentConfig(cli), system, prompt, signal });
        noteUsage(cli, res.usage);
        return { cli, ...res };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (isCapacitySignal(err)) {
          ledger?.noteLimit?.(cli, getRetryAfterMs(err));
          tried.push(cli);
          onEvent({ type: 'route', step, cli, reason: `capacity signal — cooling ${cli}`, failed: true });
          continue;
        }
        throw err;
      }
    }
    throw new NoCapacityError(`All CLIs in the pool failed step "${step}"`);
  }

  // ── Q&A path: deliberate across CLIs, then reconcile ──
  const questionLike = ['quick', 'reasoning', 'review', 'default'].includes(taskType);
  if (opts.deliberate === true || (opts.deliberate !== false && questionLike && !workingDir && !seededWorkspace)) {
    checkAbort();
    const responders = pickPool({ taskType, pool, ledger, n: Math.min(3, pool.length) });
    onEvent({ type: 'route', step: 'deliberate', cli: responders.join(','), reason: `fan-out to ${responders.length} CLIs` });
    const answers = [];
    for (const cli of responders) {
      checkAbort();
      try {
        const res = await ask({ ...cliAgentConfig(cli), system: ANSWER_PROMPT, prompt: task, signal });
        noteUsage(cli, res.usage);
        answers.push({ cli, text: res.text });
        onEvent({ type: 'chat_message', role: 'draft', cli, text: res.text });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (isCapacitySignal(err)) ledger?.noteLimit?.(cli, getRetryAfterMs(err));
        onEvent({ type: 'chat_message', role: 'system', text: `${cli} unavailable: ${err.message}` });
      }
    }
    if (!answers.length) throw new Error('No CLI in the pool could answer');
    let finalText = answers[0].text;
    if (answers.length > 1) {
      const reconciler = pickCli({ taskType: 'quick', pool, ledger, hints, exclude: [] });
      onEvent({ type: 'route', step: 'reconcile', cli: reconciler, reason: 'merge answers' });
      try {
        const res = await ask({
          ...cliAgentConfig(reconciler), system: RECONCILE_PROMPT,
          prompt: `QUESTION:\n${task}\n\n${answers.map(a => `ANSWER (${a.cli}):\n${a.text}`).join('\n\n')}`, signal,
        });
        noteUsage(reconciler, res.usage);
        finalText = res.text;
      } catch { /* keep first answer */ }
    }
    onEvent({ type: 'deliberation', responders: answers.map(a => a.cli), crossChecked: answers.length > 1 });
    onEvent({ type: 'chat_message', role: 'final', text: finalText });
    onEvent({ type: 'done', passed: true, mode: 2, crossChecked: answers.length > 1 });
    return { kind: 'answer', final: finalText, usage: { ...usageByCli } };
  }

  // ── Build path: routed coder → sandboxed workspace test → routed review ──
  let workspace = seededWorkspace || null;
  if (!workspace && workingDir) {
    const seeded = await createWorkspaceFromDir(workingDir, workspacesDir, { dependencyRoot });
    workspace = { id: seeded.id, directory: seeded.directory, testFile: seeded.testFile, files: seeded.files };
    onEvent({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files, source: workingDir });
  }

  checkAbort();
  const coderStep = await routedAsk('coder', { system: CODER_PROMPT, prompt: `TASK:\n${task}${workspace ? '\n\nYou are editing the existing project already in the workspace.' : ''}`, stepType: 'code-edit' });
  let result;
  try {
    const manifest = parseWorkspaceManifest(stripCodeFences(coderStep.text));
    workspace = await createWorkspace(manifest, workspacesDir, { dependencyRoot, existingWorkspace: workspace, iteration: 1 });
    onEvent({ type: 'workspace', id: workspace.id, path: workspace.directory, files: workspace.files });
    onEvent({ type: 'status', stage: 'sandbox', label: 'Workspace tests' });
    checkAbort();
    result = await runWorkspaceTest(workspace, {
      packageRoot,
      onOutput: (v, k) => onEvent({ type: 'pty', role: 'developer', data: k === 'stderr' ? `\x1b[31m${v}\x1b[0m` : v }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    result = { stdout: '', stderr: err.message, exitCode: 1, timedOut: false };
  }
  checkAbort();
  onEvent({ type: 'sandbox', ...result });

  const diffText = await getWorkspaceDiff(workspace).catch(() => '');
  if (diffText) onEvent({ type: 'diff', iteration: 1, diff: diffText.length > 40960 ? diffText.slice(0, 40960) + '\n… [diff truncated] …' : diffText });

  const summary = `Coder: ${coderStep.cli}\nExit code: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}\nstdout:\n${result.stdout || '(empty)'}\nstderr:\n${result.stderr || '(empty)'}`;
  const reviewStep = await routedAsk('review', {
    system: REVIEW_PROMPT,
    prompt: `TASK:\n${task}\n\nMANIFEST:\n${coderStep.text}\n\nTEST RESULTS:\n${summary}${diffText ? `\n\nDIFF:\n${diffText.slice(0, 20480)}` : ''}`,
    stepType: 'review',
  });
  onEvent({ type: 'output', role: 'reviewer', text: reviewStep.text, iteration: 1 });
  const verdict = parseVerdict(reviewStep.text, new Set(['PASS', 'FAIL']));
  const passed = verdict.verdict === 'PASS' && result.exitCode === 0 && !result.timedOut;

  onEvent({ type: 'done', passed, mode: 2, completedWorkspaceDir: passed ? workspace.directory : null });
  return { kind: 'build', passed, workspace, usage: { ...usageByCli } };
}
