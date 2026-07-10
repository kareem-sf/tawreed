# Tawreed

Tawreed is a focused desktop agent that turns a BOQ Excel workbook into a
work-package workbook for procurement and delivery planning.

## Version 0.0.1

This is the first public release. The app provides one controlled workflow:

1. Choose an `.xlsx` BOQ.
2. Tawreed inspects, structures, classifies, and validates the items.
3. Review only the package counts and warnings.
4. Approve the summary to generate the Excel workbook.
5. Make any detailed corrections in Excel.

Tawreed never displays BOQ rows, spreadsheet previews, raw AI output, or
technical logs in the interface.

## Download

Open the [v0.0.1 release](https://github.com/sfkareem/tawreed/releases/tag/v0.0.1)
and download the portable file for your operating system. There is no installer
and no archive to unpack.

| Platform | Portable file |
|---|---|
| Windows 10/11 x64 | `Tawreed-windows.exe` |
| macOS | `Tawreed-macos` |
| Linux x86_64 | `Tawreed-linux` |

See [Installation](docs/INSTALL.md) for operating-system warnings and launch
instructions.

## AI connections

Codex is the default provider. It reuses the existing `codex login` ChatGPT
session and fetches the account-visible model list live. Tawreed never reads or
stores the Codex token. OpenAI, Claude, Google Gemini, and OpenAI-compatible
endpoints are also supported; their API keys are stored in the operating-system
credential manager.

## Interface

- Minimal top navigation: Workbench and Runs, with Settings/About in one menu.
- Truthful run phases and elapsed time.
- Mandatory summary approval before any workbook or history entry is created.
- Light, Dark, and System appearance modes.
- English and Arabic with complete RTL layout.
- Keyboard operation, visible focus, accessible status announcements, high-DPI
  layouts, reduced-motion handling, and system High Contrast colors.

## Local data

All application state is stored under `~/.tawreed/`:

- `config.json` — provider, model, language, and appearance; no secrets.
- `db/tawreed.db` — local run history.
- `outputs/` — generated workbooks.
- `logs/` — rotating diagnostic logs, not shown in the UI.
- `ui_state.json` — window geometry and last page.

Read [Security](SECURITY.md) for credential and provider-data details.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
python main.py
pytest -q
pyinstaller --noconfirm --clean tawreed.spec
```

Architecture and contribution guidance live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © 2026 Kareem Safwat.
