# Triforce — Three‑Mode Redesign Plan

Status: proposal / way‑forward. Supersedes the current Mode 1/2/3 semantics
(sequential handoff, cooperative loop, workspace loop).

Related docs: `RUNNING.md`, `DOCKER.md`, `CLIENT_ARCHITECTURE.md`,
`CROSS_PLATFORM_CLIENT_PLAN.md`, `SECURITY_REVIEW.md`, `OPERATIONS.md`.

---

## 0. Current state (branch `remove-api-key-providers`)

Work landed on this branch, in order:

1. **CLI‑only providers.** The hosted API providers (`anthropic`, `google`,
   `openai`) are removed from `agent.js`, `models.js`, `orchestrator.js`,
   `package.json`, `cli.js`, `public/index.html` and the tests. Only
   `claude-cli` / `codex-cli` / `agy-cli` remain; `models.config.json` defaults to
   claude‑cli (architect) + codex‑cli (developer) + agy‑cli (reviewer). No provider
   API keys are read anywhere.
2. **Docker packaging.** Two images:
   - `Dockerfile` + `compose.yml` — `node:22-slim`, the three CLIs baked in,
     unprivileged. No systemd, so `/api/capabilities` reports
     `sandbox: "unavailable"` and Mode 1/2 runs are rejected. Good for login, the
     dashboard, chat‑style use.
   - `Dockerfile.systemd` + `compose.systemd.yml` — `debian:12` booting systemd as
     PID 1; the server runs as a systemd **user** service of the `triforce` account
     so `systemd-run --user` works. `privileged: true` + tmpfs on `/run`; cgroup‑v2
     host required. Verified: `/api/capabilities` → `sandbox: "systemd"` and real
     sandboxed exec works. This is the current way to run pipelines in a container.
   - Full detail + login walk‑throughs in `DOCKER.md`.
3. **This plan**, including the Mode 1 position rename (§2).

**Update (P0–P4 landed on `modes-p*` branches, PRs #1–#5):** the redesign in this
document is now implemented.

- **P0** — protocol `1.2.0`, `router.js`, `subscription-ledger.js`, session `kind`,
  `serverCapabilities.fsRoots`, `GET /api/ledger`.
- **P1** — Mode 3 verified chat (`verified-chat.js`, `chat` command, chat UI).
- **P2** — filesystem navigator (`fs-browser.js`), `workspace.js`
  `snapshotDir`/`createWorkspaceFromDir`/`applyDiff`, Mode 1 rebuilt as the single
  Prompt Designer↔Supervisor↔Coder↔Supervisor build engine in `pipeline.js`
  (`SYSTEM_PROMPTS_BUILD`, verbatim original prompt to the Supervisor, `diff`
  events); folder bar + diff/apply in the dashboard.
- **P3** — Mode 2 credit extender (`credit-extender.js`: router + ledger failover,
  `route` events, deliberation); per‑CLI headroom bar replaces the $‑cost bar.
- **P4** — `triforce init` / `triforce doctor` in `cli.js`,
  `install-service.sh` `TRIFORCE_FS_ROOTS` pass‑through, docs.

Deferred: the shared‑client Miller‑column browser and a richer diff viewer;
cross‑restart Mode 3 conversation memory.

Where run data lands: `~/.local/share/triforce/runs/` and `.../workspaces/` — inside
the container that is the `triforce-systemd-home` (or `triforce-home`) named volume;
transcripts (opt‑in) go to `./transcripts/` in the bind‑mounted project dir.

---

## 1. Vision

Triforce is a **local backend with a browser front end**. You install it once in a
terminal, authenticate the three local CLIs (`claude`, `codex`, `agy`), and are handed
a URL. Opening that URL gives you a thin web client that drives the backend running on
your own machine — including the ability to browse the machine's filesystem, pick a
working folder, and run one of three modes against it.

No provider API keys anywhere. All model access is the three CLI logins, reused by the
server process (see the CLI‑only provider change on branch `remove-api-key-providers`).

### Locked decisions (from design review)

| Question | Decision |
| --- | --- |
| Existing Mode 1/2/3 semantics | **Replace.** New Mode 1 absorbs today's cooperative loop *and* the multi‑file workspace capability. The sequential‑only path is retired. |
| How a run touches a chosen real folder | **Sandboxed copy + apply.** Browse the real FS; the run works on a copy inside the systemd sandbox; the user reviews a diff and explicitly applies it back. |
| Mode 2 ("Credit Extender") primary job | **Route + deliberate.** Pick the best CLI per task, spread load across the three subscriptions to dodge rate/usage limits, and for questions have the models cross‑review and return the best/merged answer. No designer/coder/supervisor roles. |
| Mode 3 ("Chat") | Standard chat app. Every answer is drafted, then **checked by all three models** and reconciled before it is shown. |

The modes are referred to only as **Mode 1 / Mode 2 / Mode 3** (no nicknames). Each has
a one‑line purpose below.

---

## 2. The three modes

### Mode 1 — structured build (Prompt Designer → Supervisor → Coder → Supervisor)

**Purpose:** turn a task into working, test‑passing changes inside a chosen project,
under an iterative review loop.

**Three named positions**, each with its own model dropdown in the UI (see below):
**Prompt Designer**, **Coder**, **Supervisor**. This replaces today's
architect / developer / reviewer labels (and the `SEQUENTIAL` mode name). Any of the
three CLIs can be assigned to any position.

**The loop** (anchored throughout to the human's original prompt, which defines the
scope):

1. Human enters the original task/prompt + selects a working folder.
2. **Prompt Designer** turns it into an implementation prompt/spec.
3. **Supervisor** reviews that prompt *against the original human prompt's scope* —
   is it in scope, complete, unambiguous? Returns `APPROVE` or `REVISE` + notes.
4. If `REVISE`: back to the **Prompt Designer**, which refines the prompt; return to
   step 3. Loop until the Supervisor approves (cap `maxPromptIterations`).
5. The approved prompt goes to the **Coder**, which writes/edits files in a workspace
   copy of the selected folder.
6. The declared test file runs in the sandbox (`runWorkspaceTest`).
7. **Supervisor** assesses the code *against the original prompt + approved spec* and
   returns `PASS` or `FIX` + specific fixes.
8. If `FIX`: back to the **Coder** with the feedback + sandbox output; return to
   step 6. Loop until `PASS` (cap `maxCodeIterations`, default from `maxIterations`,
   hard cap 10).

- Working set: a **copy** of the selected folder created with `createWorkspace()`
  under `TRIFORCE_WORKSPACE_ROOT`. Dependencies exposed read‑only. Generated paths
  validated by `safePath()`.
- Output: `getWorkspaceDiff()` unified diff streamed to the client + an **Apply**
  action (see §3) that writes the diff back to the real folder (git‑aware: refuse or
  branch if the real folder is a dirty git tree, configurable).
- Engine = today's Mode 2 cooperative loop (`SYSTEM_PROMPTS_MODE2`: `designer`,
  `supervisorPromptCheck`, `coder`, `supervisorCodeCheck`) generalised to multi‑file
  projects via `SYSTEM_PROMPTS_WORKSPACE`; the two merge into one `SYSTEM_PROMPTS_BUILD`
  set. The Supervisor's system prompt is given the verbatim original human prompt in
  both review stages so its scope judgement is stable.

**UI changes** (`public/index.html`):

- Triangle labels `lbl0/1/2` and `.shard-label.{architect,developer,reviewer}` →
  **Prompt Designer** / **Coder** / **Supervisor**.
- Per‑position model dropdowns already exist (`prov-architect`/`mod-architect`,
  `…-developer`, `…-reviewer`) — rename the ids/labels to `prompt-designer` /
  `coder` / `supervisor` and keep the provider→model rebuild logic.
- Summary‑card role text is currently hard‑coded (`CLAUDE CODE`, `CODEX`,
  `ANTIGRAVITY`) — drive it from the assigned model instead.
- `config` keys sent on `run`: `promptDesigner` / `coder` / `supervisor`
  (keep accepting the old `architect`/`developer`/`reviewer` names as aliases for
  one release).
- `models.config.json` gains the new key names; old files still load via the alias.

### Mode 2 — credit extender (router + deliberation)

**Purpose:** get the most work out of three CLI subscriptions combined, and get a
cross‑checked answer, without the fixed designer/coder/supervisor structure.

- **No roles.** A single **router** decides, per step, which CLI handles it:
  - *Task fit*: heuristic/table mapping task type → preferred CLI
    (e.g. code‑edit → `codex`/`claude`, broad reasoning → `claude`, quick/cheap →
    `agy`). Configurable.
  - *Capacity*: a **subscription ledger** (see §6) tracks per‑CLI usage, cooldowns,
    and last `429`/usage‑limit signal from `agent.js` (`getErrorStatus`,
    stderr `usage limit` detection). The router skips a CLI in cooldown and fails
    over to the next.
- **Deliberation** for question/answer steps: fan the prompt to 2–3 CLIs, then a
  final "reconcile" call (cheapest available CLI) merges/selects the best answer with
  a short rationale. For code steps, deliberation is optional (defaults off for
  speed; on for "important" tasks).
- Still sandboxed: any code it runs goes through `runSandboxed()`; any file changes
  go through the workspace‑copy + apply flow, same as Mode 1.
- Emits per‑CLI cost/usage so the UI usage bar can show **subscription headroom**
  instead of dollar cost (the current $‑based bar is replaced — see §7).

### Mode 3 — verified chat

**Purpose:** a normal chat app whose every answer is validated by all three models
before you see it.

- Turn flow:
  1. **Drafter** (router‑picked CLI, or round‑robin) answers the message.
  2. **Checkers** = the other two CLIs (or all three) each critique the draft for
     correctness / omissions / disagreement.
  3. **Reconciler** produces the final answer, noting any unresolved disagreement
     inline ("2 of 3 models agree; dissent: …").
- Optional **read‑only folder context**: attach the selected folder; files are
  exposed read‑only to the drafter/checkers. **No writes, no execution** in Mode 3 —
  switching to Mode 1/2 is required to change anything.
- Transcript persisted per conversation (see §6); resumable like a run.
- This is the smallest mode to ship and validates the multi‑CLI plumbing → **build
  it first** (§11).

---

## 3. Filesystem navigator (new capability, shared by all modes)

A server‑side, rooted file browser plus a Miller‑column ("Finder columns") UI in the
web client.

### Server API (new `fs` command family on the WebSocket, or REST under `/api/fs`)

| Call | Returns / effect |
| --- | --- |
| `fs.roots` | Allowed root(s): `$HOME` by default; extendable via `TRIFORCE_FS_ROOTS` (colon‑list). Nothing outside a root is listable. |
| `fs.list { path }` | One directory level: entries with name, type, size, mtime, `isGitRepo`, `isSymlink`. Path normalised + confined to a root (reuse/extend `safePath()`). Dotfiles hidden by default. |
| `fs.stat { path }` | Single entry detail (for previews / breadcrumb). |
| `fs.selectWorking { path }` | Marks the working folder for the session. Server snapshots it into a workspace copy (`createWorkspace()` from a directory manifest) lazily on first run. |
| `apply { runId, mode: 'all' \| 'files', paths? }` | Writes the reviewed diff from a completed run back into the real working folder. Pre‑flight: real folder unchanged since snapshot (mtime/hash), git clean‑or‑branch policy, path allowlist. Emits an `apply_result` event. |

### UI

- Top‑of‑screen **path bar**: breadcrumb + a column browser that expands to the
  right as you descend (keyboard navigable). "Use this folder" button per column.
- Selected folder shown as a chip next to the mode toggle; all three modes read it.
- After a run: **diff viewer** (per‑file, expandable) with **Apply all / Apply
  selected / Discard**.

### Security model (see also §9)

- Reads: confined to `TRIFORCE_FS_ROOTS`; symlinks resolved and re‑checked against
  roots; no following out of a root.
- Runs never execute against the real folder — always the sandboxed copy.
- Writes happen **only** via the explicit `apply` action, never implicitly, and are
  path‑checked and change‑detected.
- Mode 3 never writes.

---

## 4. First‑run / onboarding

New `triforce init` (extends `cli.js` setup wizard + `install-service.sh`):

1. **Dependency check/install** — `checkAndInstallDependencies()` verifies `claude`,
   `codex`, `agy` on `PATH`/`~/.local/bin`; offers to install any missing.
2. **Login walk‑through** — for each CLI: run `checkClaudeLogin()` /
   `checkCodexLogin()` / `checkAgyLogin()`; if not logged in, launch its device/OAuth
   flow and wait for confirmation. All three are required to finish (or `--skip <cli>`
   to defer, with a warning that routing/deliberation degrades).
3. **Token** — generate a high‑entropy `TRIFORCE_TOKEN`, write `.env` (chmod 600).
4. **Service** — render + install the systemd unit as the invoking user
   (`install-service.sh`), start it, wait for `/api/capabilities` to return `200`
   and `sandbox: "systemd"`.
5. **Hand‑off** — print the access URL for each LAN IP (`getNetworkIPs()`), the
   token, and a terminal QR code for the phone. Also write `triforce-access.txt`.

`triforce doctor` (new): re‑checks logins, sandbox availability, disk in the
workspace root, and prints the same access info.

---

## 5. Architecture impact (graph map)

Existing modules and what changes. Run `graphify update .` after each phase so the
graph tracks this.

| Node / module | Change |
| --- | --- |
| `packages/protocol/src/index.js` | `pipelineModeSchema` keeps `1\|2\|3` but semantics are redefined; add `fsCommandSchema` family, `applyCommandSchema`, `chatCommandSchema`; extend `serverEventSchema` enum with `fs_list`, `diff`, `apply_result`, `chat_message`, `deliberation`, `route`. Bump `PROTOCOL_VERSION` 1.1.0 → **1.2.0** (minor, backward compatible; major stays 1). |
| `server.js` | WS switch gains `fs.*`, `apply`, `chat`; `/api/fs/*` REST alternative; `serverCapabilities` advertises `modes: [1,2,3]`, `fsRoots`, `features: [..., "filesystem", "deliberation", "apply"]`. Keep `probeSandbox()` gate for Modes 1 & 2 (Mode 3 exempt — no exec). |
| `pipeline.js` | Split. `executePipeline()` stays as the **Mode 1** engine (merge Mode‑2 loop + workspace loop; drop sequential‑only branch). New `creditExtender.js` (Mode 2) and `verifiedChat.js` (Mode 3) engines with the same `(task/message, config, ctx, onEvent)` shape. `SYSTEM_PROMPTS*` reorganised: `PROMPTS_BUILD`, `PROMPTS_DELIBERATION`, `PROMPTS_CHAT`. |
| `agent.js` | Add a lightweight `ask()` path (no retry loop change) used by router/deliberation; expose structured error class for capacity signals; unchanged CLI spawn/parse core. |
| `router.js` (new) | Task‑type → CLI table + capacity‑aware selection; consumes the subscription ledger; pure, unit‑testable. |
| `subscription-ledger.js` (new) | Per‑CLI rolling usage, cooldown timers, `429`/limit backoff; persisted under `TRIFORCE_RUNS_DIR`. Feeds router + UI headroom bar. |
| `workspace.js` | `createWorkspace()` gains a "from existing directory" manifest builder (walk a real folder → manifest, honouring `.gitignore`); add `snapshotDir()` + `hashTree()` for apply pre‑flight; `applyDiff(workspace, realPath, policy)` new. |
| `fs-browser.js` (new) | `roots()`, `list()`, `stat()` with root confinement built on a hardened `safePath()` (shared move of `safePath` from `workspace.js` into here). |
| `sandbox.js` | Unchanged for exec. Mode 3 does not call it. |
| `run-registry.js` | Generalise "run" to "session" with a `kind` (`build` \| `credit` \| `chat`); chat transcripts and deliberation events use the same append‑only jsonl + replay/`subscribe`. `getLatestUsage()` → per‑CLI. |
| `models.js` | `ALLOWED_MODELS` already CLI‑only. Add optional `ROUTER_HINTS` (task‑type → preferred CLI) here or in `models.config.json`. |
| `models.config.json` | New optional keys: `mode` default, `router` hints, `deliberation` on/off per mode, `apply.gitPolicy`. Existing `architect/developer/reviewer` still used by Mode 1. |
| `cli.js` | `init` / `doctor` subcommands; login walk‑through; access hand‑off + QR. |
| `install-service.sh` | Pass through `TRIFORCE_FS_ROOTS`; unchanged otherwise. |
| `public/index.html` | Mode toggle relabelled (`STRUCTURED BUILD` / `CREDIT EXTENDER` / `VERIFIED CHAT` as descriptions, ids stay `btn-mode1..3`). New: column FS browser + folder chip, diff/apply viewer, chat view, per‑CLI headroom bar replacing the $‑cost bar (`ubProv*` rework). `PROVIDERS` map already CLI‑only. |
| `clients/shared`, `clients/desktop`, `clients/android` | Consume protocol 1.2: new events, FS browser view, chat view. Native file picking can defer to the same server `fs.*` API (don't use native FS). |
| Tests | New: `router.test.js`, `subscription-ledger.test.js`, `fs-browser.test.js` (root confinement, symlink escape), `workspace.test.js` +apply/snapshot, `verified-chat.test.js`, `credit-extender.test.js`. Update `server-protocol.test.js` for new commands/events and `modes` capability. |
| Docs | This file; update `RUNNING.md` (modes, FS roots, onboarding), `CLIENT_ARCHITECTURE.md`, `SECURITY_REVIEW.md` (FS trust boundary), `OPERATIONS.md` (ledger/backup, `TRIFORCE_FS_ROOTS`). |

### God‑node / community note

Today `RunRegistry`, `executePipeline()`, `Agent` are the hubs. After this change the
new hubs are `router.js` and `subscription-ledger.js` (Mode 2), `fs-browser.js` +
`workspace.js` (navigator/apply), and `run-registry.js` as the shared session spine
for all three modes. Expect `pipeline.js`'s community to split into
build / credit / chat clusters.

---

## 6. Data & persistence

Everything under `TRIFORCE_RUNS_DIR` (memory‑bounded live, jsonl on disk, lost‑buffer
semantics unchanged):

- **Session index** `index.json`: entries gain `kind`, `mode`, `workingFolder`,
  `status`.
- **Build sessions**: `<id>.jsonl` events (`status/output/sandbox/diff/…`), plus a
  `<id>.diff` snapshot and an `apply_result` record if applied.
- **Chat conversations**: `<id>.jsonl` with `chat_message` (role: user / draft /
  check‑<cli> / final) and `deliberation` events; resumable.
- **Subscription ledger** `ledger.json`: per‑CLI `{ callsWindow, tokensWindow,
  cooldownUntil, lastLimitAt }`; rolling window (e.g. 5 min + 24 h). Backed up per
  `OPERATIONS.md`.
- **Working‑folder snapshots**: hash/mtime manifest kept with the workspace copy for
  apply pre‑flight; GC'd with `gcWorkspaces()`.

---

## 7. Protocol changes (concrete)

```
PROTOCOL_VERSION: '1.1.0' -> '1.2.0'   (PROTOCOL_MAJOR stays 1)

client -> server (new):
  { type: 'fs.roots' }
  { type: 'fs.list',  path: string }
  { type: 'fs.stat',  path: string }
  { type: 'fs.selectWorking', path: string }
  { type: 'apply',    runId: uuid, scope: 'all' | 'files', paths?: string[] }
  { type: 'chat',     conversationId?: uuid, message: string,
                      folder?: string, deliberate?: boolean }

run command:
  mode 1 = structured build (was 2 + 3)
  mode 2 = credit extender
  mode 3 = verified chat        (or use the dedicated 'chat' command)
  config: mode 1 keeps architect/developer/reviewer;
          modes 2/3 accept an optional 'pool' (subset of the 3 CLIs) + 'deliberate'

server -> event enum adds:
  'fs_list', 'diff', 'apply_result', 'route', 'deliberation', 'chat_message'

capabilities adds:
  modes: [1,2,3], fsRoots: string[], features += ['filesystem','deliberation','apply']
```

Old clients (protocol 1.1) still negotiate; they see Modes 1–3 with new behaviour and
simply don't send `fs.*` / `chat`. A hard cutover of mode *meaning* is acceptable
because the server is upgraded before clients (per `RELEASE_NOTES.md`).

---

## 8. Security & trust boundaries

The filesystem navigator widens the boundary the most. Controls:

1. **Root confinement** — all `fs.*` paths normalised and verified inside
   `TRIFORCE_FS_ROOTS` (default `$HOME`); symlinks resolved then re‑checked; deny by
   default. Single shared `safePath()` implementation, fuzz/escape‑tested.
2. **No implicit writes** — real folders are only ever modified by an explicit
   `apply`, which re‑checks the path allowlist and that the folder is unchanged since
   snapshot; git‑dirty → refuse or auto‑branch per `apply.gitPolicy`.
3. **Execution unchanged** — Modes 1 & 2 still require `sandbox: "systemd"`; all code
   runs via `runSandboxed()` / `runWorkspaceTest()` against the **copy**, private
   network, writes confined to the workspace. Mode 3 cannot execute at all.
4. **Least authority per mode** advertised in `capabilities` and enforced
   server‑side, not just hidden in the UI.
5. **Secrets** — `.env`, `~/.ssh`, `~/.aws`, and other CLIs' credential dirs are
   excluded from `fs.list` even inside a root (denylist + no dotfiles by default).
6. Token / origin / redaction rules from `OPERATIONS.md` unchanged.

`SECURITY_REVIEW.md` gets a new "Filesystem navigator and apply" section covering
threat model (path traversal, symlink escape, TOCTOU on apply, accidental overwrite,
secret disclosure) and the mitigations above.

---

## 9. Migration

- **Server first.** Ship the 1.2 server; it accepts 1.1 clients.
- **Mode meaning changes silently** — document loudly in `RELEASE_NOTES.md`. The old
  "sequential" mode is gone; anyone scripting `mode: 1` now gets the build loop
  (strictly more capable). `mode: 3` no longer means "workspace" — that folded into
  `mode: 1`.
- **`models.config.json`** — old files still valid (the `architect/developer/reviewer`
  block is what Mode 1 reads). New keys are optional with safe defaults.
- **UI** — relabel the three buttons; keep ids. Old bookmarks/PWA installs keep
  working.
- **Docs** — `RUNNING.md` PWA/onboarding section rewritten around `triforce init`.

---

## 10. Phased delivery

Status: **P0–P4 complete** (branches `modes-p0-foundations` … `modes-p4-onboarding`).

| Phase | Scope | Acceptance |
| --- | --- | --- |
| **P0 — foundations** ✅ | Move `safePath` → `fs-browser.js`; `subscription-ledger.js` + `router.js` (pure, tested); protocol 1.2 schemas + capability fields; `run-registry` "session kind". No UI. | New unit tests green; `server-protocol.test.js` updated; capabilities shows `modes`/`fsRoots`. |
| **P1 — Mode 3 (verified chat)** ✅ | `verifiedChat.js` engine; `chat` command + events; chat view in `public/index.html`; conversation persistence + replay. Multi‑CLI fan‑out/reconcile proven here. | Ask a question → draft + 2 checks + reconciled answer streamed and persisted; reconnect resumes; works with 1–3 CLIs logged in. |
| **P2 — filesystem navigator + Mode 1** ✅ | `fs.*` API + column UI + folder chip; `createWorkspace` from real dir; `getWorkspaceDiff` viewer; `apply` with pre‑flight + git policy; merge Mode‑2 loop + workspace loop into the Mode 1 engine. | Pick a real folder → run Mode 1 → review diff → Apply → changes land; escape/symlink tests pass; dirty‑git policy enforced. |
| **P3 — Mode 2 (credit extender)** ✅ | Wire router + ledger into a roleless engine; task‑fit table; failover on capacity signal; optional deliberation for Q&A; per‑CLI headroom bar replaces $‑cost bar. | Under a simulated `429` from one CLI, work continues on another; headroom bar reflects ledger; deliberated answer beats single‑model on a fixed eval set. |
| **P4 — onboarding + polish** ✅ | `triforce init` / `doctor`; QR + `triforce-access.txt`; native clients (desktop/Android) updated to protocol 1.2; docs (`RUNNING.md`, `SECURITY_REVIEW.md`, `OPERATIONS.md`, `CLIENT_ARCHITECTURE.md`). | Fresh machine → `triforce init` → URL in browser → all three modes usable end‑to‑end. |

Each phase: branch, tests in a container, `graphify update .`, PR.

---

## 11. Open questions / risks

1. **`agy` CLI shape** — plain‑text output, `usageUnknown`. Deliberation/reconcile
   prompts must tolerate a model that can't report tokens; ledger uses call‑count
   fallback for `agy`.
2. **Reconciler cost** — every chat turn is ≥3 CLI calls (+1 reconcile). Acceptable
   for "verified" positioning; expose a "fast" toggle that drops to draft + 1 check.
3. **Apply on large/binary folders** — cap workspace snapshot size; skip binaries in
   diff; `.gitignore`‑aware walk mandatory.
4. **TOCTOU on apply** — snapshot hash check narrows but doesn't eliminate; consider
   an fs‑lock or "apply into a fresh git branch only" as the safe default.
5. **Router quality** — start with a hand table + capacity failover; a learned router
   is out of scope for now.
6. **Multi‑user** — still single‑operator (`TRIFORCE_TOKEN`). FS roots are the
   server user's; document that sharing the URL shares that user's filesystem view.
7. **Mode 3 folder context size** — token budget; need a retrieval/first‑N‑files
   strategy, not "dump the tree".

---

## 12. Graphify maintenance

- This document is indexed by graphify; keep it current as phases land.
- After each phase's code changes: `graphify update .` (AST‑only, no API cost).
- Expect new communities around `router.js` / `subscription-ledger.js` /
  `fs-browser.js` and a split of the `pipeline.js` community into build/credit/chat.
