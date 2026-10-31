# Tawreed: the updater, the installer identity and the release inputs

Date: 2026-10-10; revised 2026-10-11 after Engineering Lead changes requested. Task QSM-3, branch `agent/qsm-3-updater`. Nothing is released, no key exists yet, and the updater
has never run on Windows or Linux: see "Not checked" at the end.

Saved launch choices in QSM-2/QSM-7: Windows AND Linux, app ID `com.qsmind.tawreed`, all rights reserved,
MinIO hosting at `https://downloads.qsmind.app/tawreed/latest.json` (replaced 2026-10-18, see below), and Windows
without Authenticode.
This records the choices returned by the Engineering Lead; it is not merge, deploy or release approval.
Tauri updater signatures remain mandatory. Hosting belongs to Platform (QSM-24).

## 1. How the updater works

- The desktop app uses Tauri's updater (`tauri-plugin-updater`). An update is the same Windows NSIS installer or Linux AppImage people
  download, or, on a Mac, the zipped app (`.app.tar.gz`), with a signature file beside it. The app only installs a file whose signature matches the public key
  built into it.
- **One address.** `plugins.updater.endpoints` in `desktop/tauri.release.conf.json`. Since 2026-10-18 (founder's
  choice) downloads and updates come from GitHub releases of this repo, `qs-mind/tawreed`, not a QS Mind server:
  `https://github.com/qs-mind/tawreed/releases/latest/download/latest.json`. GitHub serves release files to anyone
  only from a public repo; while the repo is private these links ask for a GitHub sign-in. It is built into
  every package. `npm run release` works out each installer's address from it
  (`releases/download/v<version>/<installer>`).
- **Fixed file names.** Each release carries `Tawreed_x64-setup.exe`, `Tawreed_amd64.AppImage`, `Tawreed_aarch64.app.tar.gz`,
  `Tawreed_x64.app.tar.gz` and the download-only `Tawreed_aarch64.dmg` and `Tawreed_x64.dmg`, without the
  version, so the download buttons on qsmind.app link to
  `https://github.com/qs-mind/tawreed/releases/latest/download/<file>` and start the download directly;
  nobody has to open GitHub.
- **When it checks.** Once, when Tawreed opens. Offline or no answer: nothing is shown and nothing fails.
- **What the engineer sees.** A line under the header on every tab: "Tawreed 0.2.0 is ready to install." with
  "Update and restart". Nothing installs until they press it, so a running job is never cut off by surprise.
  English and Arabic.
- **What happens on "Update and restart".** The app downloads the installer, checks the signature, stops the local
  service (so its files can be replaced), and runs the installer with a progress bar and no questions. Tawreed
  closes and opens again as the new version. `installMode` is `currentUser`, so no administrator prompt. Data in
  `~/.tawreed` is not touched.
- **Where the code is.** The page asks the desktop app, as it asks for everything else, through the `api` scheme:
  `GET /desktop/update` answers `{"version": "0.2.0"}` or `{"version": null}`; `POST /desktop/update` installs.
  The desktop app answers these itself (`desktop/src/main.rs`); the Python service is not involved. The line is
  `ui/src/app/Update.tsx`.
- **Off until there is a key.** While `plugins.updater.pubkey` is empty the app never checks, and `npm run release`
  prints "NOT FOR RELEASE". This is why the installer still builds today without any key.
- Only a higher version is ever offered. A bad release is fixed by a higher version, never by going back.

Not built (say if you want them): a "Check now" button, an "Updates" row in About (the line under the header shows
on About too), a check while the app stays open for days, release notes in the app.

## 2. The updater signing key

Made on 2026-10-18 with the founder's approval, in the cloud, by the steps below. The private key and its
password are in the QS Mind project's shared folder, `.secrets/tawreed-updater/`; the public key is committed.
Copy the private key and password to the password manager and one offline copy. The steps stay for a future key.

1. On the founder's own machine, in the repo folder:

   ```
   npx tauri signer generate -w ~/.tauri/tawreed-updater.key
   ```

   It asks for a password. Use one. It writes two files: `tawreed-updater.key` (private) and
   `tawreed-updater.key.pub` (public).
2. **Private key and its password:** into the password manager, as two entries, plus one offline copy (for example
   a USB stick kept apart from the laptop). Never in the repo, a task, a comment or chat. On the release machine
   they are environment variables for that one terminal only: `TAURI_SIGNING_PRIVATE_KEY` (the file's path or its
   text) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. **Public key:** paste the text of the `.pub` file into `plugins.updater.pubkey` in
   `desktop/tauri.release.conf.json`, set `bundle.createUpdaterArtifacts` to `true` in the same file, and commit.
   The public key is not a secret.

**If the private key is lost, no installed Tawreed can ever be updated**: every user must download and install by
hand. **If it leaks, someone else can sign an "update".** Then: make a new key, ship one last update signed with
the old key that carries the new public key, and stop using the old one. The key is hard to change after the first
release, so it needs the founder's yes like the app ID.

## 3. Release inputs

What must be true before a build can be released:

| Input | Where | State |
|---|---|---|
| Update address | `plugins.updater.endpoints` in `desktop/tauri.release.conf.json` | Selected in QSM-7; deployment separate |
| Updater public key | `plugins.updater.pubkey`, same file | Set 2026-10-18 |
| `createUpdaterArtifacts` | `bundle`, same file | `true` |
| Private key and password | Environment variables on the release machine | In the project's `.secrets/tawreed-updater/` |
| App ID | `identifier` in `desktop/tauri.conf.json` | `com.qsmind.tawreed`; selected launch identity |
| Publisher, copyright | `desktop/tauri.release.conf.json` | "QS Mind"; "© 2026 QS Mind. All rights reserved." |
| Version | `package.json`, `package-lock.json` (twice), `desktop/Cargo.toml`, `desktop/Cargo.lock` (the `tawreed-desktop` entry), `desktop/tauri.conf.json`, `service/pyproject.toml`, `service/tawreed/__init__.py` | Same number in all seven files. `npm run release` refuses to continue if one differs |
| Thmanyah font files | `ui/src/fonts/thmanyah/` on the release machine | Not in the repo (licence) |

Build natively on every platform. The **Release build** workflow does it on GitHub runners (Windows, Ubuntu 22.04,
macOS 15 on Apple silicon and macOS 15 on Intel); by hand it is `npm run verify`, then `npm run package` on each
system. Linux uses AppImage, the package supported by Tauri's Linux updater; no DEB/RPM update promise is made.
The Mac app is signed ad hoc (`signingIdentity: "-"`): there is no Apple developer account and no notarization,
so macOS asks the user to confirm the first launch (see the README). Apple's updater needs the app itself, so the
workflow zips `Tawreed.app` by hand (`Tawreed_<version>_<aarch64|x64>.app.tar.gz`) after checking it with
`codesign --verify`; the DMG is only for a first install and is not in the update feed.

GitHub builds are never signed for the updater, because the private key must not go there. They are built with
`createUpdaterArtifacts: false`, and the key signs four files afterwards, on the founder's machine, each with the
version bound to the signature:

```
npx tauri signer sign --app-version <version> -f ~/.tauri/tawreed-updater.key <file>
```

for `Tawreed_<version>_x64-setup.exe`, `Tawreed_<version>_amd64.AppImage`, `Tawreed_<version>_aarch64.app.tar.gz`
and `Tawreed_<version>_x64.app.tar.gz`. `npm run release` decodes every `.sig` and refuses one that does not carry
`version:<version>`, so an old signature cannot be reused for a new release.

Collect the same version from all builds into a clean staging directory:

```
<staging>/nsis/Tawreed_<version>_x64-setup.exe(.sig)
<staging>/appimage/Tawreed_<version>_amd64.AppImage(.sig)
<staging>/macos-aarch64/Tawreed_<version>_aarch64.app.tar.gz(.sig)
<staging>/macos-aarch64/Tawreed_<version>_aarch64.dmg
<staging>/macos-x64/Tawreed_<version>_x64.app.tar.gz(.sig)
<staging>/macos-x64/Tawreed_<version>_x64.dmg
npm run release -- <staging>
```

The script writes `<staging>/SHA256SUMS.txt` (all six files) and `<staging>/latest.json` with the **four** update
entries (`windows-x86_64`, `linux-x86_64`, `darwin-aarch64`, `darwin-x86_64`). It refuses to replace a feed if any
file, any signature, or the version in a signature is wrong, or if the version differs between files. Synthetic
tests prove this; the updater itself verifies that a signature is cryptographically valid.
Without a public key, it writes checksums for available native packages but no feed, and prints NOT FOR RELEASE.
It also copies each file to the staging folder under its fixed name. Never upload an old feed left in a
staging folder. Upload the six fixed-name files, `SHA256SUMS.txt` and `latest.json` to one GitHub release
`v<version>` of `qs-mind/tawreed`, only with the founder's approval. Nothing publishes here; the **Publish
release** workflow does the upload in two runs (a draft to sign, then the four signatures), and tags the exact
commit the build ran on.

## 4. Installer identity and the app ID

- Publisher is "QS Mind". Copyright is "© 2026 QS Mind. All rights reserved."
- The selected proprietary licence is reflected in EN/AR About, root/service LICENSE, npm metadata (UNLICENSED),
  Cargo's licence-file and Python metadata (LicenseRef-Proprietary). Third-party font notices remain unchanged.
  This branch changes no brand assets. Older MIT copies in brand branches need reconciliation by their owner.
- App ID `com.tawreed.desktop` → `com.qsmind.tawreed` remains its own commit (`1d40e69`).
  It is the selected launch identity. No further app-ID change is included.

What the app ID changes on Windows:

- **Moves:** the app's own folder, `%LOCALAPPDATA%\com.tawreed.desktop\` → `%LOCALAPPDATA%\com.qsmind.tawreed\`. It
  holds `logs\service.log` and the window's browser data, which remembers only the language and the light or dark
  theme until the service answers.
- **Does not move:** projects, keys and settings (`~/.tawreed`), the install folder and the Start menu entry (both
  use the name "Tawreed").
- **Breaks today:** nothing. Nothing has been released. A PC that ran an older test build keeps an empty-ish
  leftover folder `%LOCALAPPDATA%\com.tawreed.desktop`; delete it by hand.
- **If it were changed after a release:** logs would start in a new folder, the old folder would be left behind
  (uninstall would not clean it), and on macOS and Linux the system would see a different app. So: decide once, now.

## 5. Building the Windows installer

I could not build the installer: I work on Linux, and the build path the repo uses (`npm run package`) needs
Windows, because PyInstaller can only freeze the service for the system it runs on.

What I did check on Linux: `npm run verify` (typecheck, Ruff, Clippy with the new plugin, service tests, interface
tests) and that both config files still parse and merge.

What is needed to check the installer, on a Windows 10 or 11 PC with Python 3.12, Node 24 and the Tauri
prerequisites (README, "Development"):

```
git fetch && git switch agent/qsm-3-updater
py -3.12 -m venv service/.venv
service/.venv/Scripts/python -m pip install -e "./service[dev]"
npm ci
npm run verify
npm run package
npm run release
```

Expected: `desktop\target\release\bundle\nsis\Tawreed_<version>_x64-setup.exe` exists; `npm run release` writes
checksums in the bundle folder and prints "NOT FOR RELEASE: no updater public key". No key is needed for this build.

## 6. Test steps on a clean Windows PC (for QA)

"Clean" means a Windows 10 or 11 PC or virtual machine where Tawreed, Python, Node and Rust were never installed.
Use a normal user, not an administrator. Use synthetic BOQs only.

### Part A: first install (can run as soon as someone builds the installer in section 5)

1. Copy `Tawreed_<version>_x64-setup.exe` to the PC. Compare its SHA-256 with `SHA256SUMS.txt`
   (`certutil -hashfile <file> SHA256`). Expect: equal.
2. Double-click it. Expect: "Windows protected your PC" (the build is not code-signed). Click "More info", then
   "Run anyway". Write down the exact words shown, and what "Publisher" says.
3. Go through the installer. Expect: no administrator prompt; English or Arabic by the Windows language.
4. Open Tawreed from the Start menu. Expect: the window opens and Home shows "Drop BOQ files here" within a minute.
   No line about updates.
5. About tab. Expect: the right version and a data folder under your user folder.
6. Check `%LOCALAPPDATA%\com.qsmind.tawreed\logs\service.log` exists. Check `%LOCALAPPDATA%\com.tawreed.desktop`
   does **not** exist.
7. Settings > Apps > Installed apps, find Tawreed. Expect: publisher "QS Mind".
8. Right-click `%LOCALAPPDATA%\Tawreed\Tawreed.exe` > Properties > Details. Expect: copyright
   "© 2026 QS Mind. All rights reserved."
9. Drop a synthetic BOQ and take it as far as the launch test plan (QSM-6) says.
10. Close Tawreed. In Task Manager, expect no `tawreed-service.exe` left after a few seconds.
11. Uninstall from Settings. Expect: the app is gone; `%USERPROFILE%\.tawreed` (your projects) is still there.

### Part B: update (needs a test key, a test address and two builds)

Never use the real key for this. The builder makes a **throwaway** key (`npx tauri signer generate -w test.key`)
and, in a scratch copy of the repo that is never committed, sets in `desktop/tauri.release.conf.json`: the test
public key, `createUpdaterArtifacts: true`, and a test address (ask the Platform Engineer for an HTTPS test folder,
for example the latest release of a separate public test repo; the address must be HTTPS).

The builder makes build **N** (for example 0.1.0) and build **N+1** (0.1.1: change the version in the seven files
in section 3), each with `npm run package` and `npm run release`. Nothing is uploaded yet.

1. Install build N on the clean PC. Open it. Expect: no line about updates (the test folder is empty).
2. Turn the network off and open Tawreed. Expect: it opens and works as normal, no error about updates.
3. Network on. The builder publishes N+1: the fixed-name installer and `latest.json` in release `v<N+1>`.
4. Close and open Tawreed. Expect, within a few seconds: "Tawreed <N+1> is ready to install." under the header, on
   every tab. Switch to Arabic. Expect: the same line in Arabic, right to left.
5. Open a project and leave it open. Press "Update and restart". Expect: "Updating… Tawreed will close and open
   again.", then an installer progress bar with no questions and no administrator prompt, then Tawreed opens again
   by itself.
6. About tab. Expect: version N+1. Home and History. Expect: the project from step 5 is there, unchanged. No line
   about updates.
7. Task Manager. Expect: exactly one `Tawreed.exe` and one `tawreed-service.exe`.
8. **Tampered file.** Reinstall build N. The builder replaces the uploaded N+1 installer with a different file
   (same name, signature left as it was). Press "Update and restart". Expect: "The update couldn't be downloaded…"
   in red, Tawreed stays on N and keeps working.
9. **Broken feed.** The builder replaces `latest.json` with the text `not json`. Open Tawreed. Expect: no line
   about updates, no error.
10. **While a job runs.** With N installed and N+1 offered, start reading a BOQ and press "Update and restart"
    during the run. Write down what the project looks like after the restart. (I expect the run to stop and to be
    startable again; I have not seen it.)

Report for each step: pass or fail, the exact words on screen, and a screenshot for steps A2, B4, B5 and B8.

## 7. Native Linux build and clean install/update (for QA)

Build on an x64 Linux machine with Python 3.12, Node 24, Rust and Tauri prerequisites. Debian/Ubuntu packages:
`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
AppImage tooling also needs working FUSE (or extraction support) and network access for Tauri's bundler tools.
Build on the oldest supported distribution: building on newer glibc raises the minimum runtime requirement.
This local Arch/Omarchy build cannot establish Ubuntu/Debian compatibility.

```
python3.12 -m venv service/.venv
service/.venv/bin/python -m pip install -e './service[dev]'
npm ci
npm run verify
npm run package
npm run release
```

Expected package: `desktop/target/release/bundle/appimage/Tawreed_<version>_amd64.AppImage`.
No production key is needed for a local package. No-key release command only prepares checksums.

On a clean Linux x64 desktop with no Python/Node/Rust installed:

1. Copy the AppImage to a user-owned writable directory. Compare `sha256sum <file>` with SHA256SUMS.txt.
2. `chmod +x <file>` and run `./<file>`. If FUSE is unavailable, record the error; install the distro's FUSE runtime
   as directed by its documentation, or use `--appimage-extract-and-run` for a diagnostic. An extracted tree is not
   the install/update acceptance test. No sudo is needed to run the app.
3. Expect Home and a running bundled service. Check EN/AR About: all rights reserved and retained font notices.
   Use a synthetic project; confirm it is saved under `~/.tawreed`.
4. Close the app; confirm its service process also exits. Reopen offline; expect quiet update checks.
5. Use the throwaway-key, HTTPS-test-feed and two-build process from Windows Part B, with native AppImages.
   Collect the Windows artifacts too before generating the combined feed. Both builds must use the same test key.
6. Run N from the writable directory. Offer N+1. Confirm no installation occurs until Update and restart is pressed.
   Expect the AppImage to be replaced, restart on N+1, one service process, and unchanged synthetic projects/settings.
7. Repeat with tampered N+1 bytes, a broken feed, an unwritable AppImage location, and an active BOQ run.
   Record exact errors and project recovery. A failed install must not be recorded as a successful update.
8. Delete only the AppImage to uninstall; confirm `~/.tawreed` remains.

Tauri documents the native AppImage/signature format and platform keys:
https://v2.tauri.app/plugin/updater/ ; build baseline caveats:
https://v2.tauri.app/distribute/appimage/ ; prerequisites:
https://v2.tauri.app/start/prerequisites/ . Checked 2026-10-11.

## Revision verification (2026-10-11)

`npm run verify` passed: typecheck, Ruff, Clippy, 124 service tests, 53 UI tests and five release tests.
EN/AR About was opened in the running foreground dev app at `127.0.0.1:15433`, with `TAWREED_HOME` set to a
run-owned synthetic directory. Screenshots show the proprietary notice, retained font notices and Arabic RTL.
The frozen Linux service answered `/about` with version 0.1.0 and exited with code 0 when stdin closed.
The desktop selects `tawreed-service.exe` on Windows and `tawreed-service` on Linux. A direct `serde_json`
dependency fixes Tauri release-context compilation with the updater config.
No licensed Arabic fonts are present in this worktree, so that check used the system fallback.
Paperclip reported no managed execution workspace; the documented foreground command was used and stopped.
The local run needed explicit `RUSTUP_HOME=/home/kareem/.rustup CARGO_HOME=/home/kareem/.cargo RUSTUP_TOOLCHAIN=stable`.
The stale Python environment was recreated with a persistent Python 3.12 installation before verification.
`npm run package` succeeded natively on Omarchy/Arch x64 (glibc 2.44):
`desktop/target/release/bundle/appimage/Tawreed_0.1.0_amd64.AppImage`, 168.19 MiB.
The bundled service exists with executable permission in `usr/lib/Tawreed/service/tawreed-service`.
`npm run release` prepared its SHA256SUMS.txt and printed NOT FOR RELEASE because no public key is configured.
This is a local diagnostic package without Thmanyah; it was not published and is not launch-approved.
The build log retains non-fatal PyInstaller optional-import warnings for pysqlite2/MySQLdb and ignored Linux icon.

## Not checked

- The Windows installer was not built here. A Windows 10/11 build machine with Python 3.12, Node 24, Rust, MSVC
  build tools and WebView2 is required. Everything in section 6 is untested.
- Clean Linux install/update and Ubuntu/Debian compatibility are NOT TESTED. QA needs clean target Linux VMs;
  actual signed updates on both systems also need two native builds, a throwaway test key and an approved HTTPS
  test location. No production signing key was made.
- The moment in step B5 where the service stops and the installer replaces its files. This is the part most likely
  to need a fix.
- Live feed/deployment is owned by Platform; endpoint availability is not a prerequisite for quiet offline checks.
- OpenConKit's updater: I could not read the repo (not found with my access), so this follows Tauri's documented
  pattern, not a copy of OpenConKit.


## Installation failure recovery — 2026-10-11

An install error no longer restarts Tawreed. After the signed download, the desktop must stop and wait for the service before installing. A stop error prevents installation. If the service is still alive it is kept; otherwise the desktop starts it again with the same port and token. An install error follows the same recovery path and returns an error to the interface. The service readiness flag is reset for a new child so requests can wait for startup. If recovery itself fails, the interface advises closing and reopening Tawreed.

Focused Rust tests cover install failure, stop failure, success, and a stopped synthetic service process that answers requests after recovery. Run `cargo test --manifest-path desktop/Cargo.toml` alongside `npm run verify`.

Fresh QA: use a throwaway signed Linux update with the existing test feed. Make the installed AppImage location unwritable to the test user, then select Update and restart. Expected: Tawreed stays open, shows the EN/AR installation error, and local service requests still work. Also repeat a successful update. Windows installer failures and native AppImage replacement still require packaged testing; the synthetic process test does not prove either platform installer.

## Update, 2026-10-31: macOS and version 0.0.2

macOS (Apple silicon and Intel) joins Windows and Linux in 0.0.2. Not yet checked on a real Mac: the DMG install,
the Gatekeeper first-run steps, a signed update from one version to the next, and whether the ad hoc signature
survives the update archive. The release build checks the signature with `codesign --verify` and starts the service
from the unpacked archive, which is a build check, not an install test. Clean-install steps for all three systems
are in `docs/clean-install-qa.md`.
