# Triforce Desktop

The desktop package embeds the shared React client in one Tauri 2 shell for Windows
and macOS. Host metadata remains in the WebView profile; access tokens are passed to
Rust commands and stored through the operating system credential backend provided by
the `keyring` crate (Windows Credential Manager or macOS Keychain).

The window restores size and position, exposes a native Switch Host menu, initializes
the updater integration for the signed update configuration added during release
packaging, blocks top-level navigation away from packaged content, and sends external
links to the operating system browser.

## Prerequisites

Install Node.js 22+, Rust stable, and the platform dependencies from the official
Tauri prerequisites guide.

Windows requires Microsoft C++ Build Tools with Desktop development with C++ and the
WebView2 runtime. macOS requires macOS 10.15+ and either Xcode or Xcode Command Line
Tools.

## Development

From the repository root:

```sh
npm install
npm run dev --workspace @triforce/desktop
```

The Tauri shell starts the shared Vite server on `127.0.0.1:4173`. For checks and an
unsigned local build:

```sh
npm run desktop:check
npm run build --workspace @triforce/desktop
```

Windows and macOS native checks also run in `.github/workflows/desktop-smoke.yml`.
Signing, notarization, updater endpoints, and release bundles are intentionally owned
by Step 8 and require repository secrets that must never be committed.
