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
