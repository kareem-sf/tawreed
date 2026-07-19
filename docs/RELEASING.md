# Releasing

Tawreed releases are Windows x64 portable executables built by GitHub Actions.
Local binaries are never uploaded as release artifacts.

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

The workflow builds and verifies a fresh executable, generates checksums,
attests the executable, and publishes:

- `Tawreed-Windows-x64.exe`
- `SHA256SUMS.txt`
- `THIRD_PARTY_NOTICES.md`
- `LICENSES.txt`, containing Tawreed and locked production dependency licenses

## Current Signing Policy

Version `0.1.0` is unsigned. Release notes must state the SmartScreen warning,
WebView2 requirement, Visual C++ runtime requirement, SHA-256 verification, and
GitHub attestation command. Do not claim Authenticode signing until the release
workflow verifies a valid timestamped signature.

## Post-Release Verification

1. Download assets from the published release into a clean directory.
2. Verify checksum and provenance.
3. Start the executable on a supported Windows x64 machine.
4. Confirm About reports the released version and no newer update.
5. Confirm the repository latest-release endpoint returns the exact executable
   asset expected by the in-app checker.
