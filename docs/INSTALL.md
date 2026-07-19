# Installation

## Requirements

- 64-bit Windows 10 or Windows 11
- Microsoft Edge WebView2 Evergreen Runtime
- Microsoft Visual C++ 2015-2022 Redistributable, x64
- An application capable of opening `.xlsx` files for the optional Open action

Excel is not required to analyze documents or generate workbooks.

## Install the Portable Release

1. Open the latest release at https://github.com/sfkareem/tawreed/releases.
2. Download `Tawreed-Windows-x64.exe` and `SHA256SUMS.txt`.
3. Verify the checksum:

```powershell
Get-FileHash .\Tawreed-Windows-x64.exe -Algorithm SHA256
```

4. Compare the result with `SHA256SUMS.txt` and, when GitHub CLI is available,
   verify provenance:

```powershell
gh attestation verify .\Tawreed-Windows-x64.exe --repo sfkareem/tawreed
```

5. Move the executable to a user-writable folder and run it.

Version `0.1.0` is not Authenticode-signed. Windows SmartScreen may require
selecting More info and Run anyway after the checksum and provenance have been
verified.

## Updating

Tawreed checks the latest stable GitHub release at every startup. About also
provides a manual check. When an update is available:

1. Download the new portable executable from the official release.
2. Close the running Tawreed process.
3. Replace the previous executable.
4. Start Tawreed again and confirm the version in About.

Tawreed never overwrites or executes a downloaded update automatically.
Existing settings, history, and generated workbooks remain under `~/.tawreed`.

## Troubleshooting

If the application does not open, install or repair WebView2 and the Microsoft
Visual C++ x64 runtime. Diagnostic logs are stored at
`~/.tawreed/logs/app.log`; redact filenames, project names, and provider error
details before sharing them.
