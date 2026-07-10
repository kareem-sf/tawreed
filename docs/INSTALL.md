# Install Tawreed 0.0.1

Tawreed is portable. Download one file from the
[v0.0.1 release](https://github.com/sfkareem/tawreed/releases/tag/v0.0.1).
Do not unzip anything and do not run an installer.

## Windows

Download `Tawreed-windows.exe` and double-click it. The file is not code-signed,
so Windows SmartScreen may show **Windows protected your PC**. Choose **More
info**, then **Run anyway**.

## macOS

Download `Tawreed-macos`, make it executable if required, and open it. If
Gatekeeper blocks the unsigned file, right-click it and choose **Open**.

## Linux

Download `Tawreed-linux`, then run:

```bash
chmod +x Tawreed-linux
./Tawreed-linux
```

Qt requires the normal desktop EGL/GL/XCB libraries. On Debian/Ubuntu:

```bash
sudo apt install libegl1 libgl1 libxkbcommon-x11-0 libxcb-cursor0
```

## Codex connection

Install the official Codex application/CLI, run `codex login`, and choose
ChatGPT. Tawreed then fetches the models available to that account. No API key
is needed for the Codex provider.
