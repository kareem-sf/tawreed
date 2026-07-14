# Install Tawreed

Tawreed releases contain direct portable executables. There is no installer and
no archive to unpack.

## Windows

Download `Tawreed-Windows-x64.exe` and run it. Until the project is code-signed,
Microsoft Defender SmartScreen may show **Windows protected your PC**. Choose
**More info**, verify the publisher/source, then choose **Run anyway**.

## macOS

Download the file matching the published architecture, make it executable if
needed, and launch it:

```bash
chmod +x Tawreed-macOS-<architecture>
./Tawreed-macOS-<architecture>
```

For an unsigned build, macOS may require a right-click **Open** confirmation or
removing quarantine after you have verified the release source.

## Linux

Download `Tawreed-Linux-x64.AppImage`, then run:

```bash
chmod +x Tawreed-Linux-x64.AppImage
./Tawreed-Linux-x64.AppImage
```

Some distributions require FUSE support for AppImage execution. The operating
system must also provide a normal graphical desktop session.

## Codex connection

Install the official Codex application or CLI, run `codex login`, and select
ChatGPT. Tawreed discovers the account-visible model catalog without reading,
copying, or storing the Codex token.
