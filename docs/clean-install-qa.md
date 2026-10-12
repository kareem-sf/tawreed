# Clean installation: six steps

Use a disposable clean Ubuntu 24.04 x86_64 desktop VM with no Tawreed installation or data. This checklist does not certify Arch Linux. Use a test account and an explicitly granted AI test connection. Do not use the founder's account or stored subscription sign-in. Start the timer before step 1; stop after step 6, including downloads, installation, setup and approvals. Pass requires all six steps, preserved source fields/provenance, exactly-once coverage, matching totals, and elapsed time below 30 minutes. A missing prerequisite is NOT TESTED, not a product failure.

Record OS/image identifier, tester, Cairo start/end time, release URL/tag, installer SHA256, screenshot names and each step's duration. Keep evidence outside the disposable VM. Screenshots must contain synthetic data only; never capture a key or sign-in token.

## 1. Download the public release

Open https://github.com/kareem-sf/tawreed-releases/releases/tag/v0.1.0 without signing in. Download `Tawreed_0.1.0_amd64.deb` and `SHA256SUMS` into a new folder. Record both URLs, HTTP result, bytes and download time. Expected: both files download without an account. Capture the release page and file names. Do not substitute the private source repo or a local build.

## 2. Check SHA256

From that folder run `sha256sum -c SHA256SUMS`. Expected: the deb reports OK. Record output and duration. Stop on a mismatch; do not install. For this release the published deb digest is `0a06329d24a434e411d42fba5581aac3a106e90f34344dfdf63aa82b9367c629` and size is 84,012,360 bytes. Recheck the manifest for each new release.

## 3. Install

In the disposable Ubuntu VM run `sudo apt install ./Tawreed_0.1.0_amd64.deb`. Record all dependency/install output and duration. Expected: exit 0 and Tawreed in the application launcher. Capture installed version with `dpkg-query -W tawreed`; confirm the package name from `dpkg-deb -f Tawreed_0.1.0_amd64.deb Package` if it differs. No Python, Node or repository checkout should be needed. Do not install onto the founder's working machine.

## 4. First launch and test connection

Launch the installed application from the application menu. Confirm no existing Tawreed data in this new VM. Expected: intact Home, History, Settings and About; one clear setup action; no crash. Switch English/Arabic and confirm RTL and readable layout; record screenshots of both. Add only the provided AI test connection in Settings, check a model and select it. Record setup time without credentials. If no test connection is granted, stop and record NOT TESTED for dependent workflow steps. Sign-in success is not proof that the model check passed.

## 5. Synthetic BOQ and approval gates

Copy `docs/qa/clean-install-boq.csv` into the VM and record its SHA256 before use. Drop it onto Home. Approve the service consent after checking its named service. Inspect each source row and its provenance. Expected: three active items with every code, description, unit, quantity, rate, amount and comment unchanged. Source arithmetic: 200 + 60 + 40 = 300; calculate this from the CSV using Decimal, rather than accepting model text. Approve/edit the plan to two packages (Concrete: C01/C02; Steel: S01). Inspect assignments: C01 and C02 only in Concrete; S01 only in Steel; approve any uncertain-assignment decision explicitly. This single source does not exercise the overlap gate. Record all decisions and time. No agent or API may answer the gates for the engineer.

## 6. Publish and check the workbooks

Approve the publish gate with rates included. Save the master and both package workbooks. Expected: one published revision, three covered items, no duplicate or unassigned item. Compare every source field and its source link, including comments. Open in LibreOffice/Excel and recalculate formulas: Concrete = 240; Steel = 60; master = 300; difference from source = 0. Record workbook file names, SHA256, item counts and actual recalculated totals, plus the coverage/revision screenshot. Confirm clicking a number opens its correct source. Close Tawreed and confirm its service exits; retain evidence and destroy only the disposable VM. Record total elapsed time and PASS/FAIL/NOT TESTED.

## Windows: founder-run record (not tested on this Linux laptop)

Use the same six steps on a clean Windows x64 VM/PC when the public NSIS installer and SHA256 manifest are published. Record Windows version and installer URL/hash. For step 2 run `Get-FileHash .\<installer>.exe -Algorithm SHA256` and compare the entire digest with its manifest entry. Step 3: run the current-user installer, record any SmartScreen prompt and publisher, use the documented warning path only after hash verification, and launch from Start. Do not disable system protection. Step 4: confirm a new `%USERPROFILE%\.tawreed` and use only a granted test connection. Steps 5/6 and the source comparisons are identical. This laptop cannot verify clean Windows installation.

| Step | Start/end | Seconds | Expected result | Actual result | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Download | | | Two public files | | | |
| 2 SHA256 | | | Exact match | | | |
| 3 Install | | | Successful install | | | |
| 4 First launch | | | Setup and model check | | | |
| 5 BOQ | | | Source unchanged; three items | | | |
| 6 Publish | | | 240 + 60 = 300; difference 0 | | | |

Overall verdict: ____  Total seconds: ____  Tester/date: ____
