# Remote Client Security Review

Review date: 2026-07-15. Scope: the shared client, native Android and desktop shells,
versioned HTTP/WebSocket protocol, and server authentication boundary.

## Trust boundaries and assets

The Triforce server, its operator, and the OS credential stores are trusted. A saved
host is not implicitly trusted until the user authenticates it. Server output, run
events, URLs typed by users, external links, and every network between a client and a
server are untrusted. Provider credentials remain server-only. Client assets are the
Triforce access token, host metadata, run content, and update integrity.

## Threat model and controls

| Threat | Control and residual risk |
|---|---|
| Stolen or logged tokens | Android Keystore AES-GCM, Windows Credential Manager, and macOS Keychain hold reusable tokens. Authentication uses a POST body, Authorization header, or WebSocket subprotocol, never a normal client URL. The legacy URL-token route is disabled by default. Operators must redact `Authorization`, `Cookie`, and `Sec-WebSocket-Protocol` headers in reverse-proxy logs. A device account compromise can still expose credentials available to that account. |
| Token revocation/rotation | Change `TRIFORCE_TOKEN` and restart the server to revoke the old value. Users edit or delete a host to replace/remove the OS-stored value; no reinstall is needed. Active sockets close on server restart. A future multi-user release should replace the single operator token with individually revocable identities. |
| Malicious hosts and TLS interception | Host URLs reject embedded credentials, queries, fragments, and non-HTTP schemes. Real deployments use HTTPS/WSS. Native shells never bypass certificate errors. A user can explicitly choose HTTP only for narrow local development and receives an insecure warning. A malicious server can read tasks sent to it, so users must verify the host/operator. |
| WebView navigation and bridge abuse | Android serves packaged assets from the fixed appassets HTTPS origin, blocks file/content access, mixed content, popups, arbitrary navigation, and SSL-error continuation. The credential listener accepts only the packaged main frame. An outdated WebView produces an update prompt; the app never falls back to `addJavascriptInterface`. Tauri navigation remains on its packaged origin and external links use the OS. |
| XSS and hostile run output | The shared React client renders strings without raw-HTML APIs. Its CSP blocks inline scripts, plugins, foreign frames/base URLs, and non-network resource origins. Protocol events are runtime validated and terminal storage is bounded. Compromise of a packaged frontend still reaches credentials through its allowed origin, so signed distribution remains important. |
| CSRF and cross-origin data access | Browser cookies are HttpOnly and SameSite=Strict. Native CORS is restricted to fixed Android/Tauri origins plus the explicit `TRIFORCE_CLIENT_ORIGINS` operator allowlist. Bearer knowledge is still required. WebSocket upgrades require both authentication and an allowed Origin; missing and hostile origins are rejected. |
| WebSocket replay, duplication, and ordering | Commands have size/schema/version limits. Each run and event has a stable ID. Clients discard malformed, duplicate, and out-of-order events and resume after the highest accepted event ID. Server replay buffers and run history are bounded. Extremely old dropped events are represented by the run snapshot rather than silently growing memory. |
| Slow/interrupted networks | Reconnect uses capped exponential backoff and a finite attempt count. Runs are server-owned and continue after disconnect; reconnect subscribes from the accepted cursor. TLS/auth/version failures become explicit states instead of retry loops. |
| Version skew | The capability handshake checks the protocol major before opening a run. Every WebSocket command carries a protocol version; incompatible majors return `INCOMPATIBLE_VERSION`. Minor additions remain forward-compatible through loose server-event fields and a bounded event vocabulary. |
| Deep links and external navigation | Neither native shell registers an application deep-link handler. HTTP(S) links outside packaged content open externally. If deep links are added later, they require a new input-validation review. |
| Update-channel compromise | The Tauri updater code path is present but has no endpoint/public key and therefore cannot install updates. Step 8 must configure only signed HTTPS metadata and owner-controlled signing keys. Android update signing remains owner/store controlled. |

## Compatibility and deployment rules

- Put remote servers behind HTTPS and configure the proxy to preserve the public host
  and scheme. Do not log authentication headers.
- Add development frontend origins only through the comma-separated
  `TRIFORCE_CLIENT_ORIGINS` environment variable. Wildcard origins are unsupported.
- Android supports API 26+, but the installed System WebView must support the secure
  web-message-listener feature.
- Treat a protocol-major change as a coordinated server/client upgrade and retain a
  clear incompatibility error rather than attempting an unsafe downgrade.

## Review log and verification

- `npm test`: server authorization/origin/version tests, bounded replay tests, shared
  client fault/reconnect tests, protocol validation, and existing regressions.
- `npm run typecheck && npm run lint && npm run build`: shared code and production CSP
  build validation.
- `npm audit --omit=dev --audit-level=high` and full `npm audit --audit-level=high`:
  zero known vulnerabilities on 2026-07-15.
- Windows/macOS native credential tests passed in the Step 5 Actions matrix. Rust
  advisories require the CI audit added in Step 8 (this Linux host lacks a C linker).
- Secret scan: tracked sources are checked for private-key blocks and common live-token
  prefixes; examples use obvious test placeholders. No production credentials are
  committed.

Residual risks accepted for this release candidate: a single server-wide operator
token rather than per-user sessions, explicit local HTTP development, and update
delivery remaining disabled until the signed packaging milestone.
