# Triforce Remote Operations Guide

## Deployment and monitoring

Run the server as a dedicated unprivileged account behind an HTTPS reverse proxy. Set
an explicit high-entropy `TRIFORCE_TOKEN`, restrict inbound traffic, preserve the
public scheme/host for Origin checks, and redact `Authorization`, `Cookie`, and
`Sec-WebSocket-Protocol` headers. `/api/capabilities` is the authenticated readiness
probe. Monitor process restarts, WebSocket disconnects, pipeline failures, disk use in
the workspace root, and provider usage/cost alarms. The systemd example and baseline
commands remain in `RUNNING.md`.

Client connection diagnostics distinguish authentication, incompatible protocol,
reconnect, and unreachable/TLS cases. Support requests should include app/server
versions, OS/API version, sanitized host URL, run ID, timestamps, and connection state;
they must never include tokens, cookies, provider keys, or unredacted proxy logs.

## Data and backup

Back up the server's `.env` through a secrets manager, `models.config.json`, deployment
configuration, and `TRIFORCE_WORKSPACE_ROOT` if generated workspaces must survive.
Back up transcripts only when `TRIFORCE_TRANSCRIPTS=1` and organizational policy
allows their sensitive task/output content. Run history/event replay is deliberately
bounded in memory and is lost on restart; it is not a database or backup source.

Host metadata lives in each application's private WebView/local app data. Reusable
tokens live in Android Keystore, Windows Credential Manager, or macOS Keychain and
must not be exported into ordinary backups. Keep the operator token separately in the
approved password/secrets system so a device can be re-enrolled by re-adding its host.
Periodically restore server configuration/workspaces into an isolated environment and
verify permissions before declaring backups healthy.

## Upgrade

1. Read `RELEASE_NOTES.md`, verify protocol compatibility and artifact checksums, and
   retain the prior signed server/client artifacts.
2. Back up configuration/workspaces and drain or finish the active run.
3. Upgrade the server first, run the capability/readiness and deterministic remote E2E
   checks, then upgrade clients in a small canary group.
4. Validate login, all three modes, disconnect/replay, host switching, invalid-token
   handling, long output, and TLS errors before broad rollout.
5. Rotate the operator token when required, restart the server, and update each saved
   host through the app. Reinstallation is unnecessary.

Major protocol changes require coordinated clients and server. Minor additions must
remain backward compatible. Never enable legacy URL-token authentication as a normal
upgrade shortcut.

## Rollback and recovery

Stop new runs, collect sanitized diagnostics, and restore the previous server artifact
plus compatible configuration. Restore workspace data only if the upgrade changed it.
Roll clients back through the same signed channel/store; macOS/Windows users must not
bypass signature warnings. If credentials may be exposed, rotate `TRIFORCE_TOKEN`,
restart the server to terminate sockets, and delete/re-add saved hosts.

For a lost server, deploy a clean instance, restore approved configuration/workspaces,
set a new token, validate HTTPS and Origin behavior, then re-enroll clients. For a lost
device, revoke/rotate the token if the OS account or credential store may be compromised.

## Release ownership

The release owner signs off `RELEASE_CHECKLIST.md`, controls protected signing
environments, store accounts, updater metadata, tag creation, and rollback decisions.
CI artifacts are retained according to repository policy; production signed artifacts,
checksums, release notes, and provenance should have a longer owner-controlled archive.
