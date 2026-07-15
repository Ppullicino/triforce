# Release Signing and Store Delivery

The repository and ordinary CI runs produce unsigned Windows/macOS bundles and an
Android debug APK. They never contain production certificates, passwords, private
keys, provisioning profiles, or store credentials. The owner performs production
signing from protected CI environments after the unsigned artifacts and their
`SHA256SUMS` files pass review.

## Shared release procedure

1. Change only the root `package.json` version, run `npm run version:sync`, then commit
   every synchronized manifest and lockfile change.
2. Update `RELEASE_NOTES.md`, including the required server protocol and migrations.
3. Run the Release artifacts workflow from the intended commit. Compare each artifact
   to its checksum and complete the installation matrix before creating `v<version>`.
4. Use a protected `production-signing` GitHub environment with required reviewers.
   Restrict secrets to tag workflows and never expose them to pull requests or forks.
5. Sign the already-reviewed commit, publish signed checksums/release notes, then test
   the exact downloaded files. Keep the previous signed version available for rollback.

## Windows

Use an organization-owned EV/standard code-signing certificate held by the CI
provider, Azure Trusted Signing, or an HSM-backed service. Store only the provider
identity/short-lived federation configuration in GitHub; if a PFX is unavoidable,
store its base64 value and password as protected environment secrets. Sign the app
binary and installer with `signtool sign /fd SHA256 /tr <trusted-timestamp-url> /td
SHA256`, then verify with `signtool verify /pa /all`. Never upload an exportable key as
an artifact. Test SmartScreen metadata and clean install/uninstall on supported Windows.

## Apple

Use a Developer ID Application certificate and App Store Connect API key stored in the
protected signing environment. Import the certificate into a temporary keychain,
enable hardened runtime, sign nested code and the `.app`, then create/sign the DMG.
Submit with `xcrun notarytool`, wait for acceptance, staple the ticket, and verify with
`codesign --verify --deep --strict` and `spctl --assess`. Delete the temporary keychain
in an `always()` cleanup step. Mac App Store delivery additionally requires the proper
distribution certificate, entitlements, provisioning profile, and Transporter upload.

## Android

Create the upload key offline and retain encrypted backups with the owner. Put the
keystore, alias, and passwords only in the protected signing environment (or use a
short-lived secret-manager retrieval). Configure Gradle signing from environment
variables, build an AAB for Play delivery, and verify with `apksigner verify`/`jarsigner`.
Use Play App Signing so the offline app-signing key is not exposed to CI. The debug APK
from ordinary CI is for testing only and must never be submitted to a store.

## Desktop updater

The updater remains non-operational until the owner creates a dedicated Tauri updater
key, stores its private half only in protected CI, adds the public key and an HTTPS
endpoint to the release configuration, and signs update metadata. Clients must reject
unsigned metadata, a mismatched signature, non-HTTPS production endpoints, and a
version whose protocol requirements are absent from the release notes.
