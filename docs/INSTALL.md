# Installation

## Requirements

- Windows 10/11 x64 with WebView2 and the Microsoft Visual C++ 2015-2022
  x64 runtime; or
- A modern x64 Linux distribution with WebKitGTK 4.1; or
- macOS 12 or newer on Intel or Apple Silicon
- An application capable of opening `.xlsx` files for the optional Open action

Excel is not required to analyze documents or generate workbooks.

## Download And Verify

1. Open the latest release at https://github.com/kareem-sf/tawreed/releases.
2. Download `SHA256SUMS.txt` and the package for your platform:
   - Windows: `Tawreed-Windows-x64.exe`
   - Linux: `Tawreed-Linux-x64.AppImage` or `Tawreed-Linux-x64.deb`
   - macOS: `Tawreed-macOS-universal.dmg`
3. Verify the checksum:

```powershell
Get-FileHash .\Tawreed-Windows-x64.exe -Algorithm SHA256
```

```bash
sha256sum Tawreed-Linux-x64.AppImage
shasum -a 256 Tawreed-macOS-universal.dmg
```

4. Compare the result with `SHA256SUMS.txt` and, when GitHub CLI is available,
   verify provenance:

```powershell
gh attestation verify .\Tawreed-Windows-x64.exe --repo kareem-sf/tawreed
```

Use the downloaded filename in the attestation command on Linux or macOS.

## Install

### Windows

Move `Tawreed-Windows-x64.exe` to a user-writable folder and run it. Windows
SmartScreen may require More info and Run anyway after verification.

### Linux

For the AppImage:

```bash
chmod +x Tawreed-Linux-x64.AppImage
./Tawreed-Linux-x64.AppImage
```

For Debian or Ubuntu:

```bash
sudo apt install ./Tawreed-Linux-x64.deb
```

The package requires WebKitGTK 4.1. The Debian package asks `apt` to install its
declared system dependencies.

### macOS

Open `Tawreed-macOS-universal.dmg` and move Tawreed to Applications. This build
is ad-hoc signed rather than Developer ID signed or notarized. On first launch,
macOS may require Control-clicking Tawreed, choosing Open, and confirming Open,
or allowing it under Privacy & Security.

Version `0.2.0` does not use commercial Windows or Apple signing certificates.

## Updating

Tawreed checks the latest stable GitHub release at every startup. About also
provides a manual check. When an update is available:

1. Download the new package for the current platform from the official release.
2. Close the running Tawreed process.
3. Replace or reinstall the previous application package.
4. Start Tawreed again and confirm the version in About.

Tawreed never overwrites or executes a downloaded update automatically.
Existing settings, history, and generated workbooks remain under `~/.tawreed`.

## Troubleshooting

On Windows, install or repair WebView2 and the Microsoft Visual C++ x64 runtime.
On Linux, confirm WebKitGTK 4.1 is installed. Diagnostic logs are stored at
`~/.tawreed/logs/app.log`; redact filenames, project names, and provider error
details before sharing them.
