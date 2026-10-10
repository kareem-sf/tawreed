# Tawreed: the updater, the installer identity and the release inputs

Date: 2026-10-10. Task QSM-3, branch `agent/qsm-3-updater`. Nothing is released, no key exists yet, and the updater
has never run on Windows: see "Not checked" at the end.

The download place and the release runbook are the Platform Engineer's note, `docs/2026-10-10-release-and-updates.md`
(task QSM-7, a proposal on branch `qsm-7-release-proposal`). This note is the app side.

## 1. How the updater works

- The desktop app uses Tauri's updater (`tauri-plugin-updater`). An update is the same NSIS installer people
  download, with a signature file beside it. The app only installs a file whose signature matches the public key
  built into it.
- **One address.** `plugins.updater.endpoints` in `desktop/tauri.release.conf.json`. Today it is the address QSM-7
  proposes, `https://downloads.qsmind.app/tawreed/latest.json`. It is built into every installer, so it must be
  final before the first release. Changing the host is this one line; `npm run release` works out the installer's
  address from it (`v<version>/<installer>` beside `latest.json`).
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

No key exists. I did not make one. **The founder makes it, once.**

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
| Update address | `plugins.updater.endpoints` in `desktop/tauri.release.conf.json` | Proposed in QSM-7; founder has not said yes |
| Updater public key | `plugins.updater.pubkey`, same file | Empty; founder makes the key |
| `createUpdaterArtifacts` | `bundle`, same file | `false`; set `true` with the key |
| Private key and password | Environment variables on the release machine | Do not exist yet |
| App ID | `identifier` in `desktop/tauri.conf.json` | `com.qsmind.tawreed`; needs the founder's yes |
| Publisher, copyright | `desktop/tauri.release.conf.json` | "QS Mind"; "© 2026 QS Mind. MIT licence." |
| Version | `package.json`, `desktop/Cargo.toml`, `desktop/tauri.conf.json`, `service/pyproject.toml`, `service/tawreed/__init__.py` | Same number in all five |
| Thmanyah font files | `ui/src/fonts/thmanyah/` on the release machine | Not in the repo (licence) |

Then, on a Windows machine: `npm run verify`, `npm run package`, `npm run release`. With the key in place,
`npm run package` also writes `Tawreed_<version>_x64-setup.exe.sig`, and `npm run release` writes `latest.json`
beside the installer (and stops if the `.sig` is missing). Uploading is QSM-7's runbook; upload `latest.json` last.

## 4. Installer identity and the app ID

- Publisher is "QS Mind". Copyright is "© 2026 QS Mind. MIT licence.", the same line as on `brand-v2`, so the two
  branches merge cleanly. **The licence is still the founder's open decision**: if it changes, this line changes
  with it (one string).
- App ID `com.tawreed.desktop` → `com.qsmind.tawreed` is its own commit (`1d40e69`). `brand-v2` already carries the
  same change inside its brand commit. **It needs the founder's yes before the first release.**

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

Expected: `desktop\target\release\bundle\nsis\Tawreed_<version>_x64-setup.exe` exists; `npm run release` prints its
hash and "NOT FOR RELEASE: no updater public key". No key is needed for this build.

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
   "© 2026 QS Mind. MIT licence."
9. Drop a synthetic BOQ and take it as far as the launch test plan (QSM-6) says.
10. Close Tawreed. In Task Manager, expect no `tawreed-service.exe` left after a few seconds.
11. Uninstall from Settings. Expect: the app is gone; `%USERPROFILE%\.tawreed` (your projects) is still there.

### Part B: update (needs a test key, a test address and two builds)

Never use the real key for this. The builder makes a **throwaway** key (`npx tauri signer generate -w test.key`)
and, in a scratch copy of the repo that is never committed, sets in `desktop/tauri.release.conf.json`: the test
public key, `createUpdaterArtifacts: true`, and a test address (ask the Platform Engineer for an HTTPS test folder,
for example `https://downloads.qsmind.app/tawreed-test/latest.json`; the address must be HTTPS).

The builder makes build **N** (for example 0.1.0) and build **N+1** (0.1.1: change the version in the five places
in section 3), each with `npm run package` and `npm run release`. Nothing is uploaded yet.

1. Install build N on the clean PC. Open it. Expect: no line about updates (the test folder is empty).
2. Turn the network off and open Tawreed. Expect: it opens and works as normal, no error about updates.
3. Network on. The builder uploads N+1: the installer and `.sig` into `v<N+1>/`, then `latest.json`.
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

## Not checked

- The installer was not built and the updater has not run on Windows. Everything in section 6 is untested.
- The moment in step B5 where the service stops and the installer replaces its files. This is the part most likely
  to need a fix.
- The address `downloads.qsmind.app` does not exist yet (QSM-7).
- OpenConKit's updater: I could not read the repo (not found with my access), so this follows Tauri's documented
  pattern, not a copy of OpenConKit.
