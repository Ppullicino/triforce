# Triforce Remote 0.1.0 Release Notes

Status: development release candidate preparation.

## Compatibility

- Server and all clients use protocol `1.0.0` (major `1`). A different protocol major
  is rejected before a run starts; minor version additions remain compatible.
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
  Keychain. Provider API keys remain server-only.

Unsigned/debug CI artifacts are accompanied by `SHA256SUMS` and are not store-ready.
Production signing, notarization, and store delivery follow `SIGNING.md`.
