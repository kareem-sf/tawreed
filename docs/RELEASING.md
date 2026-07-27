# Releasing

Tawreed releases are built by GitHub Actions for Windows x64, Linux x64, and
macOS Intel and Apple Silicon. Local binaries are never uploaded as release
artifacts.

## Automated release flow

Use Conventional Commit titles on merged pull requests:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- A `BREAKING CHANGE:` footer or `type!:` creates a major release.
- Other commit types can appear in generated notes but do not force a release.

After a qualifying change reaches `main`, `.github/workflows/release-please.yml`
creates or updates the Release Please pull request. The workflow explicitly
dispatches CI for that bot-created branch, waits for the protected checks, merges
the pull request, and finalizes the release in the same run:

1. Updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` to one semantic
   version.
2. Generates the matching `CHANGELOG.md` entry from merged GitHub pull requests.
3. Creates the canonical `vX.Y.Z` tag and GitHub Release.
4. Calls the reusable release workflow at the immutable release commit.
5. Builds, tests, audits, signs or attests as configured, and uploads every
   verified platform package.

The protected `Release gate` is an aggregate of Windows verification, Linux and
universal macOS builds, and frontend tests on Ubuntu and macOS. Release
automation can mark it successful only after that exact five-job run passes.

An hourly recovery pass safely finalizes a release if GitHub interrupts its
originating workflow after the release pull request merges.

If Release Please creates a release and prepares the next release pull request
in the same pass, asset publication takes priority. The next pull request is
processed by the following push, dispatch, or hourly recovery run.

Release Please's manifest and configuration live in
`.release-please-manifest.json` and `release-please-config.json`. Do not edit
generated release versions by hand.

## Manual recovery

The tag trigger and the Release workflow's manual dispatch remain available if
the automation needs recovery. First update all version files and `CHANGELOG.md`
through a reviewed pull request, then create and push an annotated or signed
canonical tag:

```powershell
git tag -s vX.Y.Z -m "Tawreed vX.Y.Z"
git push origin vX.Y.Z
```

The reusable release workflow rejects tags that do not exactly match the
manifest version. Never reuse or move a published version tag.

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
