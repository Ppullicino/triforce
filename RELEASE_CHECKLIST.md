# 0.1.0-rc.1 Validation Record

Validation date: 2026-07-15. Candidate tag: `v0.1.0-rc.1`. Automated entries use
representative GitHub-hosted devices; production store
signing and physical-device acceptance remain owner release actions.

## Compatibility matrix

| Surface | Representative environment | Required evidence | Result |
|---|---|---|---|
| Server/shared protocol | Node 22 on Ubuntu | Invalid auth, native Origins, protocol skew, modes 1/2/3, disconnect/replay | PASS — release run 29449258088 |
| Android | API-29 x86_64 emulator, target/compile API 36 | Unit/lint/APK, install, activity launch, live process, hardened WebView | PASS — Android run 29449122272 |
| Windows | GitHub `windows-latest` | Shared/server tests, Cargo tests, debug/release build, native launch, checksummed installers | PASS — desktop 29449258067; release 29449258088 |
| macOS | GitHub `macos-latest` | Shared/server tests, Cargo tests, debug/release build, `.app` launch, checksummed ZIP/DMG | PASS — desktop 29449258067; release 29449258088 |

## Functional and failure cases

- [x] The three native Origins authenticate independently with the same representative
  host; invalid credentials return 401.
- [x] Modes 1, 2, and 3 start with stable run IDs and reach authoritative completion.
- [x] Disconnect during a server-owned run, reconnect, snapshot, and event replay
  recover the correct result.
- [x] Host add/delete/switch and credential replacement are covered by shared storage
  tests and OS-specific credential adapters.
- [x] Offline/reconnect uses capped attempts/backoff; duplicate, old, malformed, and
  version-incompatible events cannot corrupt state.
- [x] Terminal output remains bounded at 200,000 characters.
- [x] TLS/certificate failures are never bypassed and present corrective diagnostics.

## Security and accessibility sign-off

- [x] `SECURITY_REVIEW.md` covers tokens, malicious hosts, XSS/CSRF, origins, HTTP,
  deep links, event faults, and update channels; npm audits and tracked-source secret
  scan pass.
- [x] Keyboard-operable semantic forms/navigation, visible focus, labels, alert/status
  roles, reduced motion, responsive phone width, scalable text, and bounded live output
  have component/responsive coverage and were reviewed in the shared UI.
- [x] Android blocks file/content access, mixed content, unsafe bridge fallback, popup
  windows, SSL continuation, and in-app foreign navigation.
- [x] Desktop navigation stays on packaged origins; signing/update keys remain outside
  the repository and production updates remain disabled until signed configuration.

## Operations and release

- [x] `OPERATIONS.md` covers deployment, monitoring, support, backup/restore, upgrade,
  rollback, incident revocation, and ownership.
- [x] `SIGNING.md` covers Windows, Apple, Android, updater, protected secrets, and
  verification. `RELEASE_NOTES.md` records server compatibility and migrations.
- [x] CI artifacts include SHA-256 checksum manifests and representative launch smoke.
- [ ] Owner signs/notarizes store artifacts and performs physical-device/store-channel
  acceptance before promoting this RC to a production release.
