# Releasing

Tawreed releases are built by GitHub Actions for Windows x64, Linux x64, and
macOS Intel and Apple Silicon. Local binaries are never uploaded as release
artifacts.

## Version Preparation

1. Update `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` to the same semantic
   version.
2. Update `CHANGELOG.md` and release documentation.
3. Run `npm run verify:version`.
4. Run the full local verification documented in `README.md`.
5. Merge through a pull request with passing CI.

## Publish

Create and push the canonical tag:

```powershell
git tag -s vX.Y.Z -m "Tawreed vX.Y.Z"
git push origin vX.Y.Z
```

If signed Git tags are not configured, use an annotated tag and rely on the
GitHub Actions build provenance for artifact verification. The release workflow
rejects tags that do not exactly match the manifest version.

The workflow builds and verifies fresh packages, generates checksums, attests
all platform packages, and publishes:

- `Tawreed-Windows-x64.exe`
- `Tawreed-Linux-x64.AppImage`
- `Tawreed-Linux-x64.deb`
- `Tawreed-macOS-universal.dmg`
- `SHA256SUMS.txt`
- `THIRD_PARTY_NOTICES.md`
- `LICENSES.txt`, containing Tawreed and locked production dependency licenses

## Current Signing Policy

Current releases have no commercial platform certificates. Windows remains
unsigned and macOS uses ad-hoc signing without notarization. Release notes must
state the platform warnings, native runtime requirements, SHA-256 verification,
and GitHub provenance. Do not claim Authenticode, Developer ID signing, or
notarization until the workflow verifies those identities.

## Post-Release Verification

1. Download assets from the published release into a clean directory.
2. Verify checksum and provenance.
3. Start each package on its supported platform.
4. Confirm About reports the released version and no newer update.
5. Confirm the latest-release endpoint returns the exact package expected by
   the in-app checker on each platform.
