# Triforce Android

The Android app packages the shared Triforce frontend and serves it inside WebView from
`https://appassets.androidplatform.net`. First launch therefore displays the shared
full-URL host setup screen; later launches retain host metadata and retrieve tokens
through the Android credential adapter.

Tokens are encrypted with AES-256-GCM. The non-exportable encryption key is generated
and retained by Android Keystore, while only IV+ciphertext is stored in private app
preferences. The JavaScript/native message listener is restricted to the packaged
HTTPS origin and main frame. The app never uses `addJavascriptInterface`.

WebView file/content access, mixed content, popup windows, and arbitrary in-app
navigation are disabled. Certificate errors are cancelled. HTTPS is required for real
hosts; cleartext is permitted only for `10.0.2.2` and `localhost` during emulator
development and is labeled insecure by the shared host UI.

## Requirements and commands

- Android Studio or command-line SDK with API 36 and Build Tools 36.0.0
- JDK 17+
- Gradle 9.4.1
- Node.js 22+ and `npm install` completed at the repository root

From the repository root:

```sh
gradle -p clients/android testDebugUnitTest lintDebug assembleDebug
gradle -p clients/android connectedDebugAndroidTest
```

The build compiles the shared frontend into generated Android assets. APKs and all
generated assets remain under ignored `build/` directories.
