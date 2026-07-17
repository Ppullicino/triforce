# TRIFORCE MASTER TASK LIST (machine-readable)

<!--
  FORMAT CONTRACT — do not deviate:
  Each task is one fenced block delimited by `### [Task ID]`.
  Fields appear one per line as `- [Field]: value`.
  Allowed Status values: PENDING | IN-PROGRESS | COMPLETED
  Dependencies reference Task IDs, comma-separated, or NONE.
  Worker agents: read the SOP at the bottom of this file before touching anything.
-->

Generated: 2026-07-17 by Lead Architect pass (graphify-oriented scan of orchestrator.js, agent.js, server.js, sandbox.js, workspace.js, run-registry.js, usage.js, models.config.json).

---

### [CORE-001]
- [Status]: COMPLETED
- [Dependency]: NONE
- [Objective]: Fix the Mode 1 CLI crash in `orchestrator.js`. `runArchitect()` (line ~57) references `TASK`, but `TASK` is a `const` local to `main()` (line ~109). Running `node orchestrator.js` in Mode 1 throws `ReferenceError: TASK is not defined` at Stage 1. Refactor `runArchitect(agent, task)` to accept the task as a parameter and pass it from `main()`.
- [Identified Pitfalls]: Do not "fix" it by hoisting TASK to module scope — argv parsing must stay inside main(). Mode 2 does not call runArchitect, so a Mode 2 smoke test will NOT catch a regression here; test Mode 1 explicitly.
- [Acceptance Criteria]: `node orchestrator.js "trivial task" --mode 1` reaches Stage 2 without ReferenceError (provider errors are acceptable if keys are absent). Add/extend a unit test in `test/` that imports or exercises the stage-1 path with a stubbed Agent.

### [CORE-002]
- [Status]: COMPLETED
- [Dependency]: NONE
- [Objective]: Harden child-process IPC in `agent.js` `_collectChild()` / CLI callers. (a) Attach a `child.stdin.on('error')` handler before `child.stdin.end(stdin)` — a CLI that exits before draining stdin emits EPIPE, which is currently an unhandled 'error' event that crashes the whole orchestrator. (b) Guard `killTree()` when `child.pid` is undefined (spawn failure). (c) Make `_collectChild`'s timer the single timeout owner for CLI providers — `Agent.call()` additionally wraps CLI calls in `withTimeout()`, producing two racing timers of the same duration where the outer one rejects without killing the child.
- [Identified Pitfalls]: `detached: true` is only set on non-win32; `process.kill(-pid)` fails on Windows — keep the existing platform branch. Killing after `finish()` settled must stay idempotent (`settled` flag). Do not remove the output-byte cap logic while refactoring.
- [Acceptance Criteria]: A test in `test/agent.test.js` spawns a fake CLI (e.g. `node -e 'process.exit(1)'`) with a large stdin payload and asserts the promise rejects with the CLI error instead of the process dying on EPIPE. Timeout kills the child exactly once (no double-settle warnings).

### [CORE-003]
- [Status]: COMPLETED
- [Dependency]: CORE-001
- [Objective]: Extract the duplicated pipeline logic into a shared module (e.g. `pipeline.js`). Modes 1 and 2 are implemented twice — once in `orchestrator.js` (console transport) and once in `server.js` `runPipeline()` (WebSocket transport) — with duplicated SYSTEM_PROMPTS, verdict parsing, and executionSummary construction; Mode 3 (workspace) exists only in server.js. Unify behind an event-emitter/callback transport so orchestrator.js and server.js become thin adapters, and Mode 3 becomes available from the CLI.
- [Identified Pitfalls]: server.js sends incremental `runLog.*` accumulations while orchestrator prints per-iteration — the shared module must emit granular events and let each transport decide accumulation. Keep `maxIterations` clamping (1..10) from server.js as the canonical behavior (orchestrator hardcodes 3). Preserve transcript logging (TRIFORCE_TRANSCRIPTS=1) semantics.
- [Acceptance Criteria]: `npm run test:server` passes; orchestrator.js and server.js contain no duplicated SYSTEM_PROMPTS or mode loops; Mode 3 runnable via CLI; behavior of WS events unchanged (existing protocol tests green).

### [RESIL-001]
- [Status]: COMPLETED
- [Dependency]: CORE-002
- [Objective]: Rate-limit bridging in `agent.js`. (a) Honor `Retry-After` / provider-supplied retry hints when present instead of fixed exponential backoff. (b) Classify CLI provider failures: a non-zero exit whose stderr matches rate-limit/overload markers (e.g. `rate limit`, `429`, `overloaded`, `usage limit`) must be retryable; today ANY non-zero CLI exit is terminal. (c) Make MAX_RETRIES and backoff ceiling configurable via env (TRIFORCE_MAX_RETRIES, TRIFORCE_BACKOFF_CAP_MS) — 3 retries/max ~4s is too short to bridge real 429 windows.
- [Identified Pitfalls]: Anthropic/OpenAI SDKs already retry internally in some configurations — avoid multiplicative retry storms; cap total wall-clock per call. Google SDK errors do not always carry `.status` in the shape `getErrorStatus()` expects — extend it defensively. Backoff sleeps must not block the server event loop for other WS traffic (they don't — but don't convert to sync waits).
- [Acceptance Criteria]: Unit tests: (1) a stubbed 429 with Retry-After: 2 waits ~2s; (2) a fake CLI exiting 1 with "rate limit" on stderr is retried and succeeds on second attempt; (3) terminal errors (400, auth) still fail fast with no retries.

### [RESIL-002]
- [Status]: COMPLETED
- [Dependency]: CORE-003
- [Objective]: Replace fragile verdict parsing with a tolerant shared parser. Today `/VERDICT:\s*(\w+)/i` defaults to FIX/FAIL on any format drift, silently burning a full iteration (and its token cost) per parse miss. Create `parseVerdict(text)` in the shared pipeline module: accept VERDICT anywhere in the text, tolerate markdown/bold/brackets, extract FEEDBACK, and return `{verdict, feedback, parsed: boolean}`. When `parsed === false`, emit a distinct event/log line so parse failures are observable rather than masquerading as review failures. Also harden `stripCodeFences()` so it only strips leading/trailing fence lines, not ``` sequences inside string literals mid-file.
- [Identified Pitfalls]: Supervisor prompts promise the format but models add prose around it — do not tighten prompts alone; the parser must be the safety net. GREENLIGHT/FIX (prompt loop) and PASS/FAIL (code loop) are different vocabularies — one parser, two accept-sets. stripCodeFences with `gm` currently mutates fenced content anywhere in the text; changing it alters developer-code output — re-run mode 1/2 fixtures.
- [Acceptance Criteria]: Table-driven tests covering ≥8 verdict formats (bold, bracketed, lowercase, trailing prose, missing FEEDBACK) all parse; unparseable text yields `parsed:false` and is surfaced in the transcript/WS event; code containing an inline ``` in a template literal survives stripCodeFences intact.

### [RESIL-003]
- [Status]: COMPLETED
- [Dependency]: CORE-003
- [Objective]: Remove all mid-pipeline `process.exit(1)` calls from orchestrator.js. Stage failures must throw/propagate so the shared pipeline can emit a structured failure event, `printSummary()` still runs (partial token spend is currently lost on failure), and the process exits with a non-zero code from a single top-level handler.
- [Identified Pitfalls]: `main()` is invoked without `.catch()` at module bottom — an unhandled rejection currently produces a noisy Node warning instead of a clean exit; add the top-level catch. Exit codes matter to `triforce.service` and any CI callers — keep non-zero on failure.
- [Acceptance Criteria]: Forcing a Stage 2 failure (bad API key) prints the TOKEN USAGE summary for Stage 1 spend and exits 1; no `process.exit` remains inside stage logic.

### [STATE-001]
- [Status]: PENDING
- [Dependency]: NONE
- [Objective]: Persist `RunRegistry` state. Runs and their event buffers are in-memory only (`run-registry.js`); a server restart loses all history and any client mid-subscribe reconnects to RUN_NOT_FOUND. Append events to JSONL per run under `~/.local/share/triforce/runs/<runId>.jsonl` (0600), write a runs index, and on boot restore snapshots, marking runs that were `running` at crash time as `failed` with a synthetic `run_state` event.
- [Identified Pitfalls]: appendFile per event can interleave under concurrent publishes — serialize writes per run (promise chain). Respect existing caps (maxEventsPerRun/maxEventBytes) for the in-memory replay buffer but persist the full stream, or document truncation. Restore must not resurrect `subscribers` (they are live sockets). Keep `snapshot()` shape identical — clients depend on it via `validateServerEvent`.
- [Acceptance Criteria]: Test: start fake pipeline (TRIFORCE_E2E_FAKE_PIPELINE=1), restart registry instance from disk, `GET /api/runs` lists the run as failed/completed with correct lastEventId; subscribe-with-afterEventId replays persisted events.

### [STATE-002]
- [Status]: PENDING
- [Dependency]: CORE-003
- [Objective]: Add run cancellation end-to-end. Extend `packages/protocol` with a `cancel` client command and a `run_state: cancelled` event; thread an `AbortSignal` through the shared pipeline into `Agent.call()` (abort SDK requests, kill CLI children via killTree) and into `runSandboxed`/`runWorkspaceTest` (systemctl kill the unit). RunRegistry gains `cancel(runId)`; server WS handler wires the command.
- [Identified Pitfalls]: Aborting between stages must not emit a misleading `error stage: architect` — emit a dedicated cancelled state. The single-active-run rule (`RunRegistry.start` throws if one is running) means cancel is the ONLY way to free a wedged run today — this task is the prerequisite for any queueing work. Bump protocol minor version and update `capabilities`; old clients must still validate (zod schema is strict — additive change only).
- [Acceptance Criteria]: E2E test: start fake pipeline, send cancel, receive `run_state: cancelled` within 2s, registry allows a new run immediately after; a real CLI child (fake sleeping process) is confirmed dead after cancel.

### [STATE-003]
- [Status]: PENDING
- [Dependency]: NONE
- [Objective]: Single source of truth for models, rates, and allowlists. `RATES` is duplicated (usage.js vs server.js, already drifted — usage.js lacks the `*-cli-default` entries), and `ALLOWED_MODELS` is hardcoded in server.js independent of `models.config.json`. Move rates + provider/model allowlist into one module (e.g. `models.js` or extend models.config.json with a catalog section); usage.js, server.js, and config validation consume it. Also fix the `latestUsage` module-level global in server.js by moving last-run usage into RunRegistry.
- [Identified Pitfalls]: Unknown models silently cost $0.00 ([0,0] fallback) — after unification, log a one-time warning per unknown model instead. `/api/config` returns models.config.json verbatim; clients may rely on its current shape — additive changes only.
- [Acceptance Criteria]: grep shows exactly one RATES definition in the repo; a config entry with a model missing from the catalog produces a startup warning; `/api/usage` reflects the most recent run after STATE-001 restore.

### [FS-001]
- [Status]: PENDING
- [Dependency]: NONE
- [Objective]: Git isolation for Mode 3 workspaces. `createWorkspace()` writes plain directories; agent iterations overwrite nothing (new dir per run) but there is no history, diffing, or rollback across iterations of the SAME run. Initialize a git repo in each workspace (`git init` + initial commit), commit after each coder iteration with message `iteration-N`, and expose the diff of the last iteration to the Reviewer prompt (bounded, e.g. first 20KB) so it reviews changes rather than re-reading the whole manifest.
- [Identified Pitfalls]: `safePath()` already blocks `.git/` paths from the manifest — keep that; the repo must be created by us, never writable via manifest. Run git with `-c user.email/-c user.name` set explicitly and `GIT_CONFIG_GLOBAL=/dev/null` (service account has no git identity; do not inherit the host's hooks/config). The sandboxed test run must NOT see network or the .git dir as writable requirement — `runWorkspaceTest` binds the workspace read-write; .git being present is fine but confirm node --permission flags don't break. git may be absent on minimal hosts — feature-detect and degrade to current behavior with a logged warning.
- [Acceptance Criteria]: After a 2-iteration Mode 3 run, `git -C <workspace> log --oneline` shows initial + 2 iteration commits; reviewer prompt for iteration 2 contains a diff section; hosts without git still complete runs (warning logged). Existing workspace tests pass.

### [FS-002]
- [Status]: PENDING
- [Dependency]: NONE
- [Objective]: Sandbox capability detection with explicit degradation. `sandbox.js`/`workspace.js` hard-depend on `/usr/bin/systemd-run --user`; on hosts without a user systemd session (containers, macOS, WSL without systemd) every pipeline dies at Stage 3 with an opaque spawn error. At server startup, probe `systemd-run --user true`; expose the result in `/api/capabilities` (e.g. `sandbox: 'systemd' | 'unavailable'`); when unavailable, refuse `run` commands with a clear protocol error naming the missing dependency (do NOT silently fall back to unsandboxed exec).
- [Identified Pitfalls]: The probe itself can hang if the user manager is broken — wrap in a short timeout. Refusing at run-time (not boot) keeps the read-only API usable for status/history. Never implement an "unsandboxed fallback" for generated code — that is a security boundary, not a convenience.
- [Acceptance Criteria]: On a host with systemd: capabilities reports sandbox available, pipelines run. Simulated missing systemd-run (PATH override in test): server boots, `/api/capabilities` reflects unavailable, `run` command returns a protocol error mentioning systemd-run.

### [FS-003]
- [Status]: PENDING
- [Dependency]: FS-001
- [Objective]: Workspace retention/GC. `WORKSPACES_DIR` grows without bound (one dir per Mode 3 iteration-passing run, plus abandoned failures cleaned only on manifest error). Implement a retention policy: keep the N most recent workspaces (default 20, TRIFORCE_WORKSPACE_KEEP) and delete older ones at server startup and after each completed run.
- [Identified Pitfalls]: Never delete the workspace of the currently running or just-completed run (it is reported to the client as preserved). Directory names start with an ISO timestamp — sort lexicographically, but tolerate foreign dirs a user created manually (skip non-matching names, never recursive-delete anything outside WORKSPACES_DIR; resolve symlinks before rm).
- [Acceptance Criteria]: Test creates 25 fake workspace dirs, GC keeps newest 20 + skips one non-matching name; the just-completed run's dir survives regardless of count.

### [OPS-001]
- [Status]: PENDING
- [Dependency]: STATE-001, STATE-002
- [Objective]: Graceful shutdown for the systemd service. On SIGTERM/SIGINT: stop accepting WS `run` commands, cancel the active run (via STATE-002 machinery) or wait up to a grace period (TRIFORCE_SHUTDOWN_GRACE_MS, default 10s), kill any live sandbox units, flush RunRegistry persistence, close the HTTP server, then exit 0.
- [Identified Pitfalls]: `httpServer.close()` waits for idle keep-alive sockets — also terminate WS clients explicitly. systemd sends SIGTERM then SIGKILL after TimeoutStopSec — the grace period must be shorter than the unit's stop timeout (check triforce.service). Double-SIGTERM should force-exit.
- [Acceptance Criteria]: Integration test: start server with fake pipeline running, send SIGTERM, observe cancelled run persisted as failed/cancelled, process exits 0 within grace period, no orphaned `triforce-sandbox-*` units remain (`systemctl --user list-units` clean).

### [OPS-002]
- [Status]: PENDING
- [Dependency]: RESIL-001
- [Objective]: Capture real usage/cost for CLI providers. `_collectChild` returns `usage: {inputTokens: 0, outputTokens: 0}`, so claude-cli/codex-cli/agy-cli runs report $0.00 and skew /api/usage. Where the CLI supports it (claude `--output-format json`, codex JSON event stream), request structured output, parse token counts, and fall back to zeros with a `usageUnknown: true` flag surfaced in cost records.
- [Identified Pitfalls]: Switching claude CLI to JSON output changes the `text` extraction path — parse the result field, don't regress plain-text mode for CLIs lacking JSON output (agy). Output-size cap must apply before JSON.parse (a huge JSON blob is still bounded by MAX_PROVIDER_OUTPUT_BYTES).
- [Acceptance Criteria]: With a stubbed claude CLI emitting a JSON envelope, cost records show non-zero tokens and no `usageUnknown`; with a plain-text stub, pipeline still succeeds and record carries `usageUnknown: true`.

---

## WORKER AGENT STANDARD OPERATING PROCEDURE (SOP)

When the user says "continue the list", execute exactly this procedure:

1. Parse this file (`graphify-out/MASTER_TASK_LIST.md`) and find the FIRST task (top-to-bottom) whose `[Status]` is `PENDING` and whose every `[Dependency]` is `COMPLETED` (or `NONE`).
2. Edit this file to mark that task `IN-PROGRESS`.
3. Implement the `[Objective]`, explicitly handling every entry in `[Identified Pitfalls]`, and write/extend tests until all `[Acceptance Criteria]` are demonstrably met (`npm run test:server` and any task-specific tests must pass).
4. Edit this file to mark the task `COMPLETED`.
5. Append a brief execution log entry to the EXECUTION LOG section below (date, Task ID, what was changed, test evidence, any deviations).
6. Run `graphify update .` to refresh the knowledge graph, then commit: `git commit -m "chore(agent): completed [Task ID] - [Brief description]"` (include the task-list and graph changes in the commit).
7. Stop and await the user's next command. Do NOT start the next task.

Rules for workers:
- Orient with `graphify query "<question>"` BEFORE reading raw source files; include this rule in any subagent prompts.
- One task per invocation. If a task proves blocked or its premise is wrong, mark it back to PENDING, record the blocker in the EXECUTION LOG, and stop.
- Never edit `[Objective]`/`[Acceptance Criteria]` of other tasks; propose changes in the log instead.

## EXECUTION LOG

- 2026-07-17 — CORE-001: Updated `runArchitect(agent, task)` and its Mode 1 caller so CLI task parsing remains local to `main()`; made the helper importable without executing the CLI and added `test/orchestrator.test.js` with a stub Agent asserting the Stage 1 task handoff. Evidence: `node --test test/orchestrator.test.js` (1/1 passed); `npm run test:server` (31/31 passed). Deviations: none.
- 2026-07-17 — CORE-002: Hardened CLI child collection by consuming stdin stream errors before writes, guarding tree kills when spawn provides no PID, retaining platform-specific/idempotent kill and output-cap behavior, and making `_collectChild` the sole CLI timeout owner. Added large-stdin early-exit and exactly-once timeout-kill tests in `test/agent.test.js`. Evidence: `node --test test/agent.test.js` (6/6 passed); `npm run test:server` (33/33 passed). Deviations: none.
- 2026-07-17 — CORE-003: Extracted duplicated pipeline logic, loops, and prompts from `orchestrator.js` and `server.js` into a new shared module `pipeline.js` with unified event-emitter/callback-based executePipeline function. Refactored `orchestrator.js` and `server.js` to act as thin adapters, and made Mode 3 (workspace) runnable from the CLI. Added E2E mock tests in `test/orchestrator.test.js` validating Mode 1 & 2 execution. Evidence: `npm run test:server` (35/35 passed). Deviations: none.
- 2026-07-17 — RESIL-001: Implemented rate-limit bridging in `agent.js` by supporting `Retry-After` header & fields parsing, defensive Google SDK error status checks, classification of CLI rate-limit failures from stderr exit codes, configurable MAX_RETRIES / backoff caps via environment variables, and total call wall-clock capping. Added four unit tests in `test/agent.test.js` validating these requirements. Evidence: `npm run test:server` (39/39 passed). Deviations: none.
- 2026-07-17 — RESIL-002: Created `parseVerdict(text, allowedSet)` in `pipeline.js` to tolerantly extract supervisor review verdicts (supporting wraps/markdown/brackets/case-insensitivity) and associated feedback, raising warning events/transcript log lines on parse failures. Hardened `stripCodeFences(text)` to target only leading/trailing fences and preserve inline triple-backticks. Added unit tests in `test/orchestrator.test.js` covering 10 table-driven verdict formats, inline fence template literals, and unparseable pipeline event warnings. Evidence: `npm run test:server` (42/42 passed). Deviations: none.
- 2026-07-17 — RESIL-003: Removed all mid-pipeline `process.exit(1)` calls from `orchestrator.js`. Re-routed error flow by adding `throw err` in `executePipeline`'s catch block (`pipeline.js`), modifying `main()` in `orchestrator.js` to catch errors and print the usage summary before rethrowing, and executing `main().catch(...)` at the module bottom. Updated `server.js` to avoid duplicate WebSocket error delivery. Added an E2E mock test in `test/orchestrator.test.js` validating that Stage 2 failure propagates, prints Stage 1 token usage summary, and triggers error rejection. Evidence: `npm run test:server` (43/43 passed). Deviations: none.
