# Triforce Cross-Platform Client Plan

## Objective

Build a Termius-style Triforce client family that connects to one or more remote
Triforce servers and presents a platform-appropriate interface on Android, Windows,
and macOS while keeping almost all product behavior in one shared client codebase.

Target architecture:

```text
Triforce server (HTTP + WebSocket, versioned protocol)
                         |
                 Shared web client
             (UI, state, protocol, hosts)
                  /               \
      Android WebView shell     Tauri desktop shell
                                /                 \
                           Windows              macOS
```

The server remains responsible for agent orchestration, provider access, sandboxing,
workspaces, and authoritative run state. Clients are responsible for saved hosts,
authentication, connection lifecycle, presentation, and platform integration.

## Agent handoff contract

This file is the source of truth for progress. A replacement agent starts by following
the cross-platform instructions in `AGENTS.md`, validates this table against Git, and
continues the first non-complete step.

Status values are `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, and `COMPLETE`.

| Step | Milestone | Status | Commit prefix | Evidence / handoff |
|---:|---|---|---|---|
| 0 | Durable roadmap and agent handoff rules | COMPLETE | `step-00:` | Plan and instructions added; planning commit records the final SHA. |
| 1 | Monorepo and shared-client foundation | COMPLETE | `step-01:` | npm workspaces, shared React/Vite client, protocol package, docs; lint, typecheck, 22 server tests, 1 client test, and builds pass. |
| 2 | Versioned server protocol and resumable run API | COMPLETE | `step-02:` | Protocol v1 schemas, capability/status APIs, stable run IDs, bounded replay registry; 25 server, 3 protocol, and 1 client tests pass. |
| 3 | Shared connection, authentication, and host profiles | COMPLETE | `step-03:` | Host CRUD, strict URL normalization, separate credential adapters, body-based session auth, state/reconnect/replay core; 25 server, 10 client, 3 protocol tests pass. |
| 4 | Shared responsive Triforce interface | COMPLETE | `step-04:` | Responsive host/task/run/history/settings/diagnostics UI, all modes, bounded stream reducer, accessibility; 25 server, 14 client, 3 protocol tests pass. |
| 5 | Desktop shell for Windows and macOS | COMPLETE | `step-05:` | Tauri 2 shell with Windows Credential Manager/macOS Keychain, restricted navigation, menus/window/updater hooks; Windows and macOS native tests, debug builds, server checks, and launch probes pass in Actions run 29442130327. |
| 6 | Android container shell | COMPLETE | `step-06:` | Kotlin shell, packaged shared client, origin-scoped bridge, Keystore AES-GCM vault, hardened WebView/network policy; unit/lint/APK and API-29 install/launch smoke pass in Actions run 29446888732. |
| 7 | Security, resilience, and compatibility hardening | COMPLETE | `step-07:` | Threat model/review log, native CORS + origin/auth enforcement, safe login/CSP, TLS/version diagnostics, validated ordered replay; 26 server, 18 client, 3 protocol tests and npm audits pass. |
| 8 | Packaging, signing documentation, and CI artifacts | COMPLETE | `step-08:` | Root SemVer synchronization, audit/test matrix, signing/release docs, and checksummed server/Windows/macOS/Android artifacts all pass in Actions run 29448101313. |
| 9 | End-to-end validation and release candidate | NOT STARTED | `step-09:` | — |

## Current handoff

- Current step: Step 9 — end-to-end validation and release candidate.
- Next action: Build the remote test harness and cross-platform validation matrix,
  exercise authentication/run/reconnect/failure cases, finish operations docs, and tag RC1.
- Known blockers: None.
- Important constraint: Do not put provider API keys in any client. Clients receive
  only Triforce host URLs and Triforce authentication credentials.

## Product decisions

- One shared frontend supplies the application UI for all three platforms.
- Windows and macOS share one Tauri shell.
- Android uses a minimal native Kotlin shell with a WebView that hosts the packaged
  shared frontend. Native Compose screens may be used for initial host setup and
  recovery, but pipeline UI behavior stays shared.
- Host configuration accepts a full URL, not only an IP address, so ports, DNS names,
  HTTPS, IPv6, and reverse-proxy paths remain possible.
- The client protocol is versioned before platform apps are built.
- Credentials use Android Keystore, Windows Credential Manager, or macOS Keychain via
  shell adapters. Browser storage must not contain reusable plaintext tokens.
- Arbitrary certificate errors are never bypassed. Plain HTTP may be supported only
  as an explicit local-network development option with visible warnings.
- Native shells allow navigation only to the configured Triforce origin; unrelated
  links open externally.

## Step 1 — Monorepo and shared-client foundation

Create a workspace structure that preserves the existing server/package entry points
and introduces a separately buildable shared frontend and protocol package.

Expected shape (adjust only when tooling provides a clearly simpler equivalent):

```text
clients/shared/       shared application frontend
clients/desktop/      Tauri shell
clients/android/      Android shell
packages/protocol/    schemas, event types, compatibility helpers
```

Acceptance criteria:

- Existing `npm start`, CLI behavior, and tests remain functional.
- Root commands can install, lint/type-check, test, and build the shared packages.
- A minimal shared client build renders locally without depending on native shells.
- Architecture and development commands are documented.
- No generated build output or credentials are committed.

Required verification: existing Node test suite plus shared-client build and tests.

## Step 2 — Versioned server protocol and resumable run API

Extract the browser/server message contract into the shared protocol package. Add a
server capability/version endpoint and identifiers for hosts, runs, and events. Move
pipeline execution toward server-owned sessions so a temporary client disconnect does
not destroy the run and a reconnecting client can retrieve current state and buffered
events. Preserve compatibility with the existing UI during migration.

Acceptance criteria:

- Client-to-server commands and server events have runtime validation and shared types.
- A capability handshake rejects incompatible major protocol versions clearly.
- Every run has a stable ID and queryable status.
- Disconnecting and reconnecting can recover an active or completed run's state.
- Event buffering has documented size/retention limits and cannot grow without bound.
- Existing authorization protects all new HTTP and WebSocket surfaces.
- Protocol and reconnect behavior have automated tests.

Required verification: server, protocol, authorization, reconnect, and regression tests.

## Step 3 — Shared connection, authentication, and host profiles

Build the reusable client core for a Termius-style host list and quick connect flow.
Keep platform storage behind an adapter so browser development can use a disposable
implementation while installed apps use OS credential stores.

Acceptance criteria:

- Users can add, edit, delete, select, and test hosts using full server URLs.
- URL normalization correctly handles HTTP(S), ports, paths, IPv6, and WebSocket URLs.
- Authentication establishes the server session without exposing tokens in logs,
  history, analytics, or normal page URLs.
- Connection state covers connecting, connected, unauthorized, incompatible,
  unreachable, disconnected, and reconnecting.
- Reconnect uses bounded exponential backoff and can recover run state from Step 2.
- Storage and transport code are covered by automated tests.

Required verification: unit tests plus integration tests against a local server.

## Step 4 — Shared responsive Triforce interface

Rebuild or migrate the existing dashboard into the shared client. The same components
must adapt to compact Android screens and larger Windows/macOS windows without losing
the current pipeline controls or streamed output.

Core screens:

- Host list and quick connect
- Task composer and mode selection
- Architect, developer, reviewer, sandbox, and workspace run views
- Live terminal output and reconnect status
- Provider/model configuration
- Usage/cost display
- Run history and run details
- Settings, host switching, and diagnostics

Acceptance criteria:

- All three pipeline modes are operable through the shared interface.
- Compact layout is usable at common phone widths and with the on-screen keyboard.
- Desktop layout supports keyboard navigation and resizable windows.
- Streaming output remains bounded and performant for long runs.
- Accessibility covers focus, labels, contrast, reduced motion, and scalable text.
- The old web UI remains available until feature parity is demonstrated.
- Critical user flows have automated component and end-to-end tests.

Required verification: shared tests/build, responsive viewport tests, and server E2E.

## Step 5 — Desktop shell for Windows and macOS

Package the shared client in one Tauri application with thin OS-specific adapters.

Acceptance criteria:

- First launch opens host setup; later launches restore the selected host safely.
- Credentials use Windows Credential Manager and macOS Keychain integrations.
- Navigation is restricted to the configured origin and external links leave the app.
- Window state, application menus, connection errors, and update-ready hooks work.
- Windows and macOS debug builds launch and connect to a test Triforce server.
- Platform prerequisites and local build commands are documented.

Required verification: shared tests plus Tauri checks and platform smoke-test evidence.

## Step 6 — Android container shell

Create a small Kotlin Android application that loads the packaged shared client in a
hardened WebView and supplies native host/credential adapters.

Acceptance criteria:

- First launch requests a full server URL and verifies connectivity.
- Credentials are stored using Android Keystore-backed facilities.
- WebView enables only required capabilities and exposes no unrestricted JavaScript
  bridge, file access, mixed content, or arbitrary navigation.
- Back navigation, reload/reconnect, host switching, offline/error states, and keyboard
  behavior are usable.
- Local HTTP support, if retained, is narrowly scoped and visibly marked insecure.
- Debug APK builds reproducibly and connects to a test Triforce server.
- Android permissions and supported OS versions are documented.

Required verification: Android unit/lint tests, debug build, and emulator/device smoke test.

## Step 7 — Security, resilience, and compatibility hardening

Perform a focused review of the new remote-client boundary and unreliable-network
behavior before distribution.

Acceptance criteria:

- Threat model covers stolen tokens, malicious hosts, WebView navigation, XSS, CSRF,
  WebSocket origin/authentication, local HTTP, logs, deep links, and update channels.
- Tokens can be revoked/rotated without reinstalling clients.
- TLS and certificate failures are presented clearly and never silently ignored.
- Slow, interrupted, duplicated, and out-of-order events do not corrupt run state.
- Server/client version skew has tested upgrade and error paths.
- Dependency and secret scans pass with documented exceptions, if any.

Required verification: security regression tests, fault-injection tests, and review log.

## Step 8 — Packaging, signing documentation, and CI artifacts

Automate reproducible unsigned development artifacts and document the owner-controlled
signing and store-release processes without committing secrets.

Acceptance criteria:

- CI builds/tests the server, shared client, Windows app, macOS app, and Android app on
  appropriate runners.
- Version numbers derive from one documented release source.
- CI produces checksummed Windows installer, macOS bundle, and Android APK artifacts.
- Windows signing, Apple signing/notarization, and Android signing procedures are
  documented with secrets referenced only through CI secret stores.
- Release notes include server compatibility and migration requirements.

Required verification: successful clean CI run and artifact installation smoke tests.

## Step 9 — End-to-end validation and release candidate

Validate a complete candidate on real or representative devices against a remotely
reachable Triforce server.

Acceptance criteria:

- Android, Windows, and macOS can add the same host and authenticate independently.
- Each platform can start and observe all three pipeline modes.
- A client can disconnect during a run, reconnect, and recover the correct result.
- Host switching, invalid credentials, offline recovery, version mismatch, and long
  terminal output behave correctly.
- Security and accessibility checklists are signed off in the repository.
- Operational, support, backup, upgrade, and rollback documentation is complete.
- A tagged release candidate and compatibility matrix are pushed.

Required verification: recorded cross-platform test matrix and full regression suite.

## Per-step completion procedure

For every implementation step, in this order:

1. Set its status to `IN PROGRESS`, record the owner/agent context if useful, and define
   the immediate `Next action` in this file.
2. Implement only the scoped milestone and add tests/documentation.
3. Run the required verification and record commands/results in its Evidence cell or
   a short subsection beneath the step.
4. Run `graphify update .` so code, documentation, and relationships are current.
5. Review `git diff` and confirm no secrets, build output, or unrelated changes exist.
6. Update the status and handoff. Use `COMPLETE` only if every acceptance criterion is
   satisfied; otherwise retain `IN PROGRESS` or set `BLOCKED` with a precise reason.
7. Commit using `<step-prefix> <concise completed work>`, for example:
   `step-03: add secure host profiles and reconnect state`.
8. Push the current branch to its configured upstream.
9. Record the pushed commit SHA in this file in the next step's initial status commit,
   or amend it before push when the SHA is already known through tooling.
10. Begin the next step only after the push succeeds.

Never rewrite or force-push shared history as part of this workflow. If a push is
rejected, fetch and inspect the remote changes, integrate them safely, rerun affected
tests and Graphify, then push normally.
