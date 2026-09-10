# Client Architecture and Development

Triforce uses npm workspaces to preserve the existing server package while sharing one
frontend and protocol library across future Android, Windows, and macOS shells.

## Packages

- `clients/shared`: React, TypeScript, and Vite application containing shared screens,
  pipeline state, host management, and connection behavior.
- `packages/protocol`: framework-neutral protocol versions, runtime schemas, shared
  message types, and compatibility helpers. Step 2 will define the full contract.
- `clients/desktop`: reserved for the Tauri Windows/macOS shell introduced in Step 5.
- `clients/android`: reserved for the Kotlin Android shell introduced in Step 6.

The existing `server.js`, `cli.js`, and `public/` application remain unchanged during
the migration. The legacy browser interface stays available until the shared client
reaches feature parity.

## Protocol and run recovery

Protocol major version 1 is implemented in `packages/protocol`. Authenticated clients
discover it at `GET /api/capabilities`, start runs with the `run` WebSocket command,
and receive a stable UUID in `run_started`. `GET /api/runs/:runId` returns current
status. A reconnecting WebSocket sends `subscribe` with the run ID and last processed
event ID; the server replies with a snapshot and retained later events.

The server retains at most 50 runs in memory. Each run retains at most 600 events and
2 MiB of serialized event data. Old events are dropped from the front of the buffer.
Runs continue while clients are disconnected, but this initial registry is process
local and does not survive a server restart.

## Hosts, credentials, and connections

The shared client normalizes full HTTP(S) server URLs and derives API and WebSocket
addresses without putting credentials into URLs. Saved host metadata is handled by a
`HostStorage` adapter. Secrets use a separate `CredentialStorage` adapter; the browser
development adapter is intentionally memory-only. Desktop and Android shells must
provide their OS credential-store adapters before release.

Clients authenticate by posting the token in a JSON body to `POST /api/session`. The
server returns an HTTP-only session cookie. The earlier query-string `/auth` flow is
retained only for compatibility with the legacy dashboard and should not be used by
new clients.

`TriforceConnection` reports explicit connection states and retries unexpected socket
closures with bounded exponential backoff. It records the active run and highest
event ID, then sends a replay subscription after reconnecting.

## Modes and the filesystem navigator (protocol 1.2)

The `run` command's `mode` keeps values `1|2|3` but the semantics were redefined:
Mode 1 is the **structured build** loop (Prompt Designer ↔ Supervisor ↔ Coder ↔
Supervisor, anchored to the verbatim original prompt, emitting `diff` events),
Mode 2 is the roleless **credit extender** (a router picks the best CLI per step,
fails over on `429` / usage-limit, and deliberates across CLIs for questions —
`route` / `deliberation` events), and Mode 3 is **verified chat** via a dedicated
`chat` command (draft → cross-check → reconcile; `chat_message` events; never
writes or executes).

A server-side rooted filesystem navigator (`fs.roots` / `fs.list` / `fs.stat` /
`fs.selectWorking`, confined to `TRIFORCE_FS_ROOTS`) lets the client pick a real
working folder. A run seeds a sandboxed workspace copy from a `.gitignore`-aware
snapshot; the reviewed diff is written back only by an explicit `apply` command,
which re-checks the folder is unchanged since the snapshot and applies into a
fresh git branch by default (`apply_result` event). The dashboard's dollar-cost
bar is replaced by a per-CLI subscription **headroom** bar from `GET /api/ledger`.

## Shared interface

The shared React interface contains host setup, task composition, all three pipeline
modes, per-role streamed output, a bounded terminal, workspace artifacts, usage cost,
session run history, editable agent settings, and connection diagnostics. Its compact
layout collapses below 800 px and has an additional phone layout below 560 px. Keyboard
focus, semantic labels, live status, scalable text, and reduced-motion preferences are
supported. The original `public/` dashboard remains the production fallback during
native-shell development.

## Commands

Run these from the repository root:

```sh
npm install
npm run dev:client
npm run lint
npm run typecheck
npm test
npm run build
```

The Vite development server is intentionally bound to `127.0.0.1`. Build output is
written to ignored `dist/` directories and is not committed.
