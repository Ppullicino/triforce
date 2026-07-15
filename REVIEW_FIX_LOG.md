# Code Review Fix Log

This log maps the whole-codebase review findings to completed changes and verification. It is intentionally kept in the repository so Graphify indexes the remediation history alongside the affected code.

## 2026-07-15

### Provider process and response reliability

- Expanded transient retry handling to include timeouts, common 5xx responses, and temporary network failures.
- Added deadlines and output-size limits to all CLI-backed providers.
- Added child-process startup error handling so missing executables reject cleanly instead of crashing or hanging.
- Made Anthropic and OpenAI response parsing tolerate valid non-text/usage-omitted response shapes and return explicit errors when text is absent.
- Verification: `node --check agent.js`, `git diff --check`, and `graphify update .` passed.

### Server boundary and execution isolation

- Removed browser-controlled persistent PTY shells.
- Added token-authenticated API and WebSocket access, HTTP-only same-site session cookies, constant-time token comparison, and WebSocket origin checking.
- Added message/task/configuration limits, provider/model allowlisting, normalized pipeline modes, capped feedback iterations, and one active run per connection.
- Replaced shared `sandbox.js` execution with unique temporary runs managed by transient systemd services. The runner uses Node permissions and systemd controls to block host writes, child processes, and internet sockets; it also limits memory, tasks, runtime, and captured output.
- Made usage accounting local to each run and added live usage events, eliminating cross-session resets and attribution races.
- Made transcripts opt-in, private, and separated by run.
- Added bounded, error-aware Graphify updates so pipeline completion cannot hang indefinitely.
- Verification: authenticated/unauthenticated HTTP and WebSocket integration checks passed. Sandbox tests prove ordinary execution, denied host writes, denied subprocesses, denied network access, and runaway-program termination.

### Pipeline correctness and configuration

- A PASS now requires both a successful sandbox result and supervisor approval. The server sends an authoritative boolean verdict and the UI no longer infers success from free-form text.
- Persisted the selected default pipeline mode and made the permission-bypass setup choice effective per agent. Permission bypass now defaults off.
- Added task arguments to the standalone orchestrator and restricted role construction to the three configured roles.
- Added deadlines, cleanup, and per-run storage so concurrent clients cannot overwrite each other's generated code.

### Dependencies, deployment, and operations

- Removed the unused PTY dependency and updated vulnerable transitive dependencies; `npm audit` reports zero vulnerabilities.
- Replaced automatic `latest` installs and remote `curl | shell` execution with read-only dependency checks and official-install guidance.
- Made systemd installation discover the invoking user, project directory, and Node executable; the installer creates a protected authentication token when needed.
- Changed PWA navigation caching to network-first and static caching to stale-while-revalidate.
- Updated operating documentation for authentication, transcript privacy, sandbox prerequisites, and portable service installation.

### Automated regression coverage

- Added a Node test suite and `npm test` script covering sandbox execution and all isolation guarantees.

## Original Finding Resolution Index

1. Unauthenticated remote shell: removed PTYs; token and origin checks added.
2. Unsandboxed generated code: replaced with restricted transient execution.
3. Unsafe LAN exposure: authenticated access and safer operating guidance added.
4. Shared `sandbox.js` race: unique per-run temporary directories added.
5. Global usage race: per-run accounting and live usage messages added.
6. Surviving subprocess trees: sandbox unit-wide termination and task limits added.
7. Provider calls without deadlines: provider timeouts added.
8. Unhandled spawn failures: child `error` handling added.
9. Unbounded output: provider and sandbox byte limits added.
10. Unvalidated WebSocket input: size, task, mode, iteration, provider, model, and concurrency validation added.
11. Vulnerable dependencies: dependency tree updated; audit is clean.
12. Ignored permission choice: persisted per-role and honored; safe mode is the default.
13. Lost default mode: stored and restored from configuration.
14. Duplicate CLI reconnect loops: reconnect state now reuses the authenticated connection settings; pipeline concurrency is rejected server-side.
15. LLM-only success verdict: sandbox success is now mandatory.
16. UI false-positive success: UI consumes the server's boolean verdict.
17. Hanging Graphify child: startup errors and a 30-second deadline added.
18. Transcript leakage/growth: disabled by default and separated into private per-run directories when enabled.
19. Working-directory paths: server-owned paths now resolve from the module directory; sandbox uses isolated temporary paths.
20. Fragile provider response parsing: explicit text selection and optional usage handling added.
21. Narrow retry policy: common transient HTTP and network failures added.
22. Login false positives: dependency/setup checks no longer claim authentication merely from automated installation; provider failures surface clearly.
23. Missing tests: seven automated regression tests added.
24. Remote unpinned installers: automatic downloads and `curl | shell` paths removed.
25. Machine-specific service: installer renders user, directory, and Node path dynamically.
26. Hardcoded standalone task: command-line task text is accepted with the original sample as fallback.
27. Stale graph: Graphify output refreshed after every remediation batch.
28. Indefinite service-worker staleness: navigation is network-first and static assets revalidate in the background.
