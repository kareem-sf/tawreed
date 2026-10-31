# Clean installation: six steps

Run this on a clean machine for each system you ship: **Windows 10 or 11 x64** (NSIS installer), **Linux x64**
(AppImage, for example Ubuntu 24.04) and **macOS 13 or newer** (DMG, once on Apple silicon and once on Intel). A
clean machine has no Tawreed, Python, Node or Rust, and no `~/.tawreed`. Use a virtual machine or a spare computer,
never the founder's working machine, a test account, and an AI test connection that was explicitly granted. Do not
use the founder's account or stored subscription sign-in.

Start the timer before step 1 and stop it after step 6, including downloads, installation, setup and approvals.
Pass needs all six steps, source fields and provenance unchanged, every item in exactly one package, matching totals
and under 30 minutes. A missing prerequisite (no machine, no test connection) is NOT TESTED, not a product failure.

Record the OS and image, the tester, start and end time, the release tag, each file's SHA-256, screenshot names and
each step's duration. Keep the evidence outside the machine. Screenshots hold synthetic data only: never a key or a
sign-in token.

Public repo: `https://github.com/qs-mind/tawreed/releases`. Do not use a local build in its place.

## 1. Download the public release

Open the release page for the tag without signing in. Download the installer for the system and `SHA256SUMS.txt`
into a new folder:

| System | File |
| --- | --- |
| Windows | `Tawreed_x64-setup.exe` |
| Linux | `Tawreed_amd64.AppImage` |
| Mac, Apple silicon | `Tawreed_aarch64.dmg` |
| Mac, Intel | `Tawreed_x64.dmg` |

Record both URLs and the sizes. Expected: both download without an account.

## 2. Check SHA-256

Compare the whole digest with its line in `SHA256SUMS.txt`. Stop on a mismatch and do not install.

- Windows (PowerShell): `Get-FileHash .\Tawreed_x64-setup.exe -Algorithm SHA256`
- Linux: `sha256sum -c --ignore-missing SHA256SUMS.txt`
- macOS: `shasum -a 256 Tawreed_aarch64.dmg` (or `Tawreed_x64.dmg`)

## 3. Install

- **Windows (NSIS).** Run the installer. Windows shows "Windows protected your PC" because the installer is not
  code-signed: record the wording and the publisher, then choose **More info** and **Run anyway** (only after step 2
  matched; never turn system protection off). Expected: no administrator prompt, Tawreed in the Start menu,
  installed for the current user in `%LOCALAPPDATA%\Tawreed`.
- **Linux (AppImage).** Copy it to a folder you own, `chmod +x Tawreed_amd64.AppImage`, then run it (or double-click).
  Expected: the window opens. If it needs FUSE, record which package the system asked for.
- **macOS (DMG).** Open the DMG and drag **Tawreed** to **Applications**; open it from Applications, not from the
  DMG. Expected first attempt: macOS says it cannot verify Tawreed (the app is signed ad hoc and not notarized).
  Record the exact words. Click **Done**, open **System Settings**, **Privacy & Security**, scroll down and click
  **Open Anyway** next to Tawreed, then confirm. If the button does not appear, run
  `xattr -dr com.apple.quarantine /Applications/Tawreed.app` and open it again, and record that you needed this.
  Expected afterwards: Tawreed opens, and later launches ask nothing.

Record the install output and duration.

## 4. First launch and test connection

Launch from the Start menu, the AppImage or Applications. Confirm there is no earlier Tawreed data. Expected: intact
Home, History, Settings and About tabs, one clear setup action, no crash, and no line about updates. About shows the
release version and a data folder under your user folder (`~/.tawreed`). Switch English and Arabic, confirm right to
left and readable Arabic text, and take a screenshot of each. Check the service log exists:

- Windows: `%LOCALAPPDATA%\com.qsmind.tawreed\logs\service.log`
- Linux: the app log folder, `~/.local/share/com.qsmind.tawreed/logs/service.log`
- macOS: `~/Library/Logs/com.qsmind.tawreed/service.log`

Add only the granted AI test connection in Settings, check a model and select it. Record the setup time without any
credential. With no test connection, stop here and record the later steps as NOT TESTED. A successful sign-in does
not prove the model check passed.

## 5. Synthetic BOQ and approval gates

Copy `docs/qa/clean-install-boq.csv` to the machine and record its SHA-256. Drop it onto Home. Approve the service
consent after checking the service it names. Inspect each source row and its provenance. Expected: three active
items with every code, description, unit, quantity, rate, amount and comment unchanged. Source arithmetic:
200 + 60 + 40 = 300; work it out from the CSV with decimals, not from model text. Approve or edit the plan to two
packages (Concrete: C01 and C02; Steel: S01). C01 and C02 only in Concrete; S01 only in Steel; answer any
uncertain-assignment decision yourself. This single source does not exercise the overlap gate. Record every decision
and the time. No agent or API answers a gate for the engineer.

## 6. Publish, and close

Approve the publish gate with rates included and save the master and both package workbooks. Expected: one published
revision, three covered items, none duplicated or unassigned. Compare every source field and its source link,
comments included. Open the workbooks in Excel or LibreOffice and recalculate: Concrete = 240; Steel = 60;
master = 300; difference from source = 0. Record file names, SHA-256, item counts and the recalculated totals.
Click a number and confirm it opens its source.

Then close Tawreed and confirm the service stops within a few seconds (Task Manager: no `tawreed-service.exe`;
Linux and macOS: no `tawreed-service` in `ps`). Uninstall (Windows: Settings > Installed apps; Linux: delete the
AppImage; macOS: drag Tawreed to the Bin) and confirm `~/.tawreed` (your projects) is still there.

## Update check (once a second release exists)

On a machine with the previous version installed, open Tawreed. Expected: "Tawreed <new version> is ready to
install." under the header; **Update and restart** replaces the app, Tawreed opens again as the new version, and your
projects are unchanged. On a Mac, record whether macOS asks for **Open Anyway** again after an update.

| Step | Start/end | Seconds | Expected result | Actual result | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Download | | | Two public files | | | |
| 2 SHA-256 | | | Exact match | | | |
| 3 Install | | | Installed; first-run prompt as described | | | |
| 4 First launch | | | Setup and model check | | | |
| 5 BOQ | | | Source unchanged; three items | | | |
| 6 Publish | | | 240 + 60 = 300; difference 0 | | | |

System: ____  Overall verdict: ____  Total seconds: ____  Tester/date: ____
