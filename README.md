# Tawreed

Tawreed is a cross-platform desktop application that turns a construction BOQ
workbook into a validated work-package workbook. The interface is React and
TypeScript inside a thin Tauri 2 host; the proven Excel and AI logic remains a
headless Python engine embedded into the final executable.

The release contract is strict: one portable executable per platform, with no
installer and no ZIP, tarball, or disk image.

## Workflow

1. Select one `.xlsx` BOQ.
2. Tawreed inspects, batches, classifies, and validates every item.
3. Review package counts and warnings without exposing BOQ rows in the UI.
4. Approve the summary once.
5. Tawreed generates the workbook and records the run locally.

## Technology

- React 19, TypeScript, Mantine, XState, and i18next.
- Tauri 2 with a small Rust process and security boundary.
- Python, OpenPyXL, and provider adapters in an embedded PyInstaller sidecar.
- Remotion for the product film.

The Rust host embeds the frozen Python engine as bytes, materializes it in a
private temporary directory at runtime, and removes it when the app exits. End
users still receive and manage only one file.

## Portable releases

[GitHub Releases](https://github.com/sfkareem/tawreed/releases) publish direct
executables under the `desktop-vX.Y.Z` version line:

| Platform | Release asset |
| --- | --- |
| Windows x64 | `Tawreed-Windows-x64.exe` |
| Linux x64 | `Tawreed-Linux-x64.AppImage` |
| macOS | `Tawreed-macOS-<architecture>` |

See [installation notes](docs/INSTALL.md) for unsigned-app warnings. Release
automation rejects installer targets, archives, and indirect artifact uploads.

## Local development

Prerequisites: Python 3.12, Node.js 24, pnpm 11, the stable Rust toolchain, and
the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for
your operating system.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
pnpm --dir desktop install --frozen-lockfile
pnpm --dir marketing-video install --frozen-lockfile
```

Run and verify the app:

```powershell
pnpm --dir desktop tauri:dev
python -m pytest --timeout=90
python -m ruff check .
python -m ruff format --check .
pnpm --dir desktop check
pnpm --dir marketing-video check
```

Build the local portable executable:

```powershell
pnpm --dir desktop tauri:build
```

The Python sidecar can be built independently with
`python scripts/build_sidecar.py`.

## Repository layout

```text
core/             Headless BOQ, provider, workbook, and persistence logic
tawreed_engine/   Versioned JSON-lines command service
desktop/          React frontend and Tauri Rust host
marketing-video/  Remotion product film source
scripts/          Sidecar builder and portable-release policy check
tests/            Headless Python engine tests
```

All user state lives under `~/.tawreed/`: non-secret settings, SQLite history,
generated workbooks, and diagnostic logs. Provider API keys use the operating
system credential manager. Read [Security](SECURITY.md) and
[Architecture](docs/ARCHITECTURE.md) for the detailed boundaries.

## License

MIT © 2026 Kareem Safwat.
