# TRIFORCE CODEBASE HEALTH REPORT — Lead Architect Audit

Date: 2026-07-17 · Auditor: Lead Technical Architect pass · Baseline: commit `cd79b19`

## PHASE 1 — COMPLIANCE & RECONCILIATION

**Claim verified: all 13 tasks are genuinely COMPLETED.** Evidence:

- Git history shows exactly one `chore(agent)` commit per task, in dependency order (`b5b4608` CORE-001 → `cd79b19` OPS-002), each bundling code + task list + graph as the SOP requires.
- Fresh `npm run test:server`: **65/65 passing** (35.1s), including sandboxed systemd-run execution tests.
- Mechanical acceptance-criteria spot-checks, re-verified against source (not logs):
  - STATE-003: exactly one `RATES` definition in the repo (`models.js:10`). ✅
  - RESIL-003: the only `process.exit` in `orchestrator.js` is the top-level `main().catch()` handler (line 113); no exits inside stage logic. ✅
  - STATE-002: protocol at 1.1.0 with `cancellation` capability; `run_state: cancelled` verified live during the OPS-001 shutdown test. ✅
  - OPS-001: `triforce.service` has `TimeoutStopSec=30` > 10s default grace. ✅
  - FS-003/OPS-002: GC pattern-matching/symlink containment and CLI usage parsers covered by dedicated tests. ✅
- Execution log entries match the diffs they describe; the two recorded mid-flight fixes (test-runner hang in OPS-001, codex `--json` arg-shape test updates in OPS-002) are honest and documented.
- Reconciliation note: `graphify-out/` has uncommitted regenerated artifacts from the post-commit rebuild hook — cosmetic churn, not drift.

**Shortcuts/debt check:** no acceptance criterion was weakened, no test was skipped or loosened. Two deliberate scope choices are inherited debt, listed under 🟡.

## PHASE 2 — STRESS-TEST WALKTHROUGH

**State & memory over long sessions**
- RunRegistry in-memory buffers are capped (600 events / 2 MB per run, 50 runs pruned with JSONL unlink) — bounded. ✅
- WS subscribers are pruned on socket close and on failed sends. ✅
- ⚠️ `usage.js` module-level `records` array grows unboundedly in the server process: `track()` pushes ~3+ records per run forever and only the CLI's `printSummary()` ever reads it. Slow leak — small objects, but a true unbounded structure in a long-lived service.

**Error resilience (provider timeout / rate limit / malformed response, right now)**
- SDK timeout → `withTimeout` ETIMEDOUT → retryable, bounded by the per-call wall-clock cap → structured `error` event → run marked `failed`; the server survives. ✅
- 429s honor `Retry-After` with configurable retries/backoff; CLI stderr rate-limit markers are retryable. ✅
- Malformed provider output: SDK response without text fails fast into a structured failure; CLI JSON that doesn't parse degrades to plain text + `usageUnknown` — nothing crashes the process. ✅
- ⚠️ Sandbox capability is probed once at boot; if the user manager breaks mid-uptime, doomed runs burn full review-loop token spend before failing (each iteration's sandbox error is fed to the reviewer).

**File-system / platform reality**
- Linux + user-systemd is the only execution-capable platform, by design (FS-002 explicitly refuses rather than falling back unsandboxed — correct security posture). The read-only API works anywhere.
- ⚠️ The FS-002 refusal exists only in `server.js`. The CLI (`orchestrator.js`) has no equivalent probe: on macOS/WSL-no-systemd, Modes 1/2 don't crash but grind through iterations feeding spawn errors to the reviewer. Windows is not a viable execution target and should be documented as such.
- ⚠️ OPS-002 assumes CLI flag support: a codex binary too old for `--json` (or claude too old for `--output-format json`) now exits non-zero and fails the call terminally. Plain-text *output* degrades gracefully; an unsupported *flag* does not.
- Two workspace roots exist (CLI: `<repo>/workspaces`; server: `~/.local/share/triforce/workspaces`), each GC'd independently — intentional but worth documenting.

## PHASE 3 — VERDICT

### 🟢 Verified Successes
- **`agent.js`** — the strongest module: single-owner timeouts, EPIPE-safe stdin, platform-guarded tree-kill, hint-honoring retries with wall-clock caps, structured CLI usage parsing with honest `usageUnknown` degradation. Fully unit-tested.
- **`run-registry.js`** — serialized JSONL persistence, crash recovery with synthetic failure events, capped replay buffers, cancellation, flush; survives restart and SIGTERM tests end-to-end.
- **`pipeline.js` + protocol** — one implementation of three modes behind an event transport, tolerant verdict parsing, versioned zod-validated protocol with replay and cancel. The CORE-003 consolidation paid off in every later task.
- **Security boundaries** — sandbox properties, `safePath`, git-isolation with `GIT_CONFIG_GLOBAL=/dev/null`, symlink-safe GC, no unsandboxed fallback, timing-safe auth. No shortcuts found.

### 🟡 Hidden Risks & Polish Items (none are Phase 2 blockers)
1. Bound or remove the `usage.js` `records` array in the server context (ring buffer or reset per run).
2. CLI capability probe: mirror FS-002's systemd check in `orchestrator.js` and fail fast with a named dependency error.
3. CLI version tolerance for OPS-002: detect "unknown flag/option" stderr on non-zero exit and retry once without the JSON flag (keeps old binaries usable).
4. Consider re-probing sandbox availability on run start (cheap, already timeout-wrapped) to avoid token burn when systemd degrades mid-uptime.
5. Document the Linux-only execution posture and the dual workspace roots in the README/service docs.

### 🛑 Next Milestone Horizon — Bridge to UI
One genuinely **mandatory** gap before wiring frontend dropdown panels:

1. **`GET /api/catalog` (or extend `/api/config` additively):** the full provider→model allowlist (`ALLOWED_MODELS`) and display rates (`RATES`) are server-internal today; `/api/config` returns only the configured trio. Dropdowns cannot be populated without this. Additive, ~30 lines + test (note `ALLOWED_MODELS` is a `Map` — needs serialization).

Strongly recommended alongside it (additive, non-blocking):
2. Include per-run `usage` in `snapshot()`/`GET /api/runs/:id` so the dashboard's run history can show cost columns without replaying JSONL (keep the change additive — clients validate with a loose schema).
3. UI must handle three already-specified states: `SANDBOX_UNAVAILABLE`, `SERVER_SHUTTING_DOWN`, and the single-active-run rejection — all exist server-side; no backend work needed.

## VERDICT: **GO** for Phase 2 (Web Dashboard Layout)

The backend is production-ready for its target platform. Condition: make the catalog endpoint (item 🛑1) the first ticket of the Phase 2 batch, since the dropdown panels depend on it; schedule the 🟡 items as background polish. Nothing warrants a HOLD.
