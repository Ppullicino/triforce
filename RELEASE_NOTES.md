# Triforce Remote 0.1.0 Release Notes

Status: development release candidate preparation.

## ⚠️ Mode semantics changed in protocol 1.2.0

The three-mode redesign (`TRIFORCE_MODES_PLAN.md`) landed. **`mode` numbers keep the
same values but mean different things** — upgrade the server before any client, and
re-read any automation that sends `run` commands:

| `mode` | Was (≤ 1.1) | Now (1.2) |
| --- | --- | --- |
| `1` | sequential handoff (architect → developer → sandbox → reviewer) | **structured build** — Prompt Designer ↔ Supervisor spec loop, then Coder ↔ Supervisor build loop, anchored to the verbatim original prompt. Absorbs the old cooperative loop *and* the old multi-file workspace loop. |
| `2` | cooperative spec/code loop | **credit extender** — roleless; a router picks the best CLI per step, fails over on `429` / usage-limit, and (for questions) deliberates across CLIs and reconciles. |
| `3` | multi-file workspace loop | **verified chat** — every answer is drafted, cross-checked by all three CLIs, and reconciled. Use the dedicated `chat` command. Never writes or executes. |

- The sequential-only path is **gone**. `mode: 1` now always runs the build loop
  (strictly more capable). `mode: 3` no longer means "workspace" — that folded into
  `mode: 1`.
- `run` config accepts new position keys `promptDesigner` / `coder` / `supervisor`;
  the legacy `architect` / `developer` / `reviewer` keys are still accepted as aliases
  for this release.
- New client commands: `fs.roots` / `fs.list` / `fs.stat` / `fs.selectWorking`,
  `apply`, `chat`. New server events: `fs_list`, `diff`, `apply_result`, `route`,
  `deliberation`, `chat_message`. `capabilities` gains `modes`, `fsRoots`, and the
  `filesystem` / `deliberation` / `apply` / `verified-chat` feature flags.
- The dashboard's dollar-cost usage bar is replaced by a per-CLI **subscription
  headroom** bar backed by `GET /api/ledger`.
- New onboarding: `triforce init` (guided) and `triforce doctor` (health check). New
  env var `TRIFORCE_FS_ROOTS` (colon-separated absolute paths, default `$HOME`)
  confines the filesystem navigator.

## Compatibility

- Server and all clients use protocol `1.2.0` (major `1`). A different protocol major
  is rejected before a run starts; minor version additions remain compatible, so a
  1.1 client still negotiates (it simply never sends `fs.*` / `chat`).
- Android requires API 26+ and a current System WebView. Windows and macOS requirements
  are listed in the platform READMEs.
- The server must be upgraded before these native clients because native-origin CORS,
  WebSocket origin authentication, stable run IDs, and replay are server features.

## Migration and security changes

- Browser token URLs are disabled. Open `/login` and submit the access token in the
  form. Temporary legacy behavior requires explicit `TRIFORCE_ALLOW_URL_TOKEN_AUTH=1`.
- Remote production hosts should use HTTPS/WSS. Configure extra development frontend
  origins through `TRIFORCE_CLIENT_ORIGINS`; wildcard CORS is unsupported.
- Re-save a host token after the operator rotates `TRIFORCE_TOKEN`. No app reinstall is
  required. Restarting the server terminates active sockets and revokes the old token.
- Native tokens remain in Android Keystore, Windows Credential Manager, or macOS
  Keychain. No provider API keys anywhere — all model access is the three local CLI
  logins reused by the server.
- The filesystem navigator reads only inside `TRIFORCE_FS_ROOTS`; secret paths
  (`.env`, `.ssh`, `.aws`, other CLIs' credential dirs) are denied even inside a root.
  Real folders are modified only by an explicit `apply`, which re-checks the folder is
  unchanged since the snapshot and, for a dirty git tree, branches or refuses per
  `TRIFORCE_APPLY_GIT_POLICY` (default `branch`).

Unsigned/debug CI artifacts are accompanied by `SHA256SUMS` and are not store-ready.
Production signing, notarization, and store delivery follow `SIGNING.md`.
