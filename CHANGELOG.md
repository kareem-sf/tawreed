# Changelog

All notable changes to Tawreed will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-06-14

### Added
- Initial public release of the Python/PySide6 rewrite.
- Work-package categorisation of Arabic + English construction BOQ
  spreadsheets via large language models.
- Multi-provider LLM support: OpenAI, Anthropic Claude, Google
  Gemini (via the OpenAI-compat endpoint), and any OpenAI-compatible
  custom base URL.
- Calibri-formatted output Excel with `wrap_text`, currency-formatted
  Amounts (`=IFERROR(D*E,0)` formulas), frozen header row, dark
  slate headers, zebra stripes, and a 60-character cap on the
  description column width.
- Single-instance desktop app via `QLocalServer` + a PID file at
  `~/.tawreed/single-instance.pid`.
- Per-user state at `~/.tawreed/` (config, history, outputs, logs,
  PID file, ui_state). One-shot migration of legacy state from
  `%LOCALAPPDATA%\Tawreed` and `<exe-dir>/tawreed` runs on first
  launch of the new version.
- Settings reset (clears config + keyring + history + outputs +
  window state).
- Streaming LLM responses with `__DONE__` sentinel protocol.
- Rotating file logger to `~/.tawreed/logs/tawreed.log` (1 MB × 3)
  and a `crash.log` written by `sys.excepthook` on unhandled
  exceptions.
- PyInstaller onefile build for Windows, macOS, and Linux
  (single EXE per platform, no folder of DLLs).
- 120 pytest tests, ~5 s runtime.

### Security
- **API keys are stored in the OS-provided secure credential store**
  (via the `keyring` Python package), **never** on disk in plaintext:
  - **Windows** → Credential Manager (DPAPI-bound to the user
    account; another Windows user on the same machine cannot read
    the value).
  - **macOS** → Keychain. The user is prompted to allow Tawreed
    the first time it accesses the keychain.
  - **Linux** → libsecret (GNOME Keyring / KWallet) when a secret
    service is available. On a headless Linux install (no D-Bus
    secret service running) Tawreed falls back to an obfuscated
    file at `~/.tawreed/.secret_fallback` (mode 0600). The fallback
    is **not** encrypted — it's a degradation path, not a security
    claim. Install `libsecret-1-0` and run a desktop session to get
    the real keyring.
- A one-shot migration on first launch moves any plaintext
  `api_key` found in a legacy `config.json` (including state from
  `%LOCALAPPDATA%\Tawreed` and `<exe-dir>/tawreed`) into the OS
  keyring and rewrites the file without it.
- The "Reset everything" Settings button wipes the keyring along
  with config, history, outputs, and window state, so resetting
  is not a half-job.
- **All persistent state lives under `~/.tawreed/`.** No data is
  written to the Windows Registry, `AppData\Roaming`, the EXE
  directory, or any location outside the user's home directory.
  See `SECURITY.md` for the full disclosure policy.

### Changed
- Window geometry and last-visited page are persisted in
  `~/.tawreed/ui_state.json` instead of the Windows Registry
  (`HKCU\SOFTWARE\sfkareem\Tawreed`). The previous QSettings-based
  path was the only writer to the registry and has been removed.

## [Unreleased]

### Added
- **Language Toggle**: Added English ↔ Arabic language switcher in Settings page. Language preference is now persisted in config.json and automatically loaded on startup. The entire UI translates between languages, including RTL layout support for Arabic.
- **Dark/Light Theme Toggle**: Added theme selection in Settings page. Users can switch between dark (default) and light themes. Theme preference is persisted and loaded on startup.
- **Recent Files List**: Added a list of recently opened BOQ files (up to 5) in the Workspace page for quick access. Files are automatically added to the list when opened.
- **Progress Bar**: Added a progress bar to the Workspace page that appears during file processing. Provides visual feedback for large file operations.
- **Toast Notifications**: Added non-blocking toast notifications for success/error messages. Toasts appear in the bottom-right corner and auto-dismiss after a few seconds.
- **Keyboard Shortcuts**: Added keyboard shortcuts for common actions:
  - `Ctrl+O`: Open file dialog
  - `Ctrl+P`: Start processing
  - `Ctrl+L`: Clear console log
  - `Esc`: Clear current selection
- **Memory Optimization**: For Excel files >10MB, the parser now uses read_only mode to reduce memory usage. For outputs with >5000 rows, uses save_virtual_workbook for memory-efficient saving.
- **Retry Logic**: Added exponential backoff retry for API calls (3 attempts with jitter). Improves reliability for transient network issues.
- **Improved Error Recovery**: Better error handling for corrupt/malformed Excel files. Added warnings for sheets without recognizable headers.
- **Dependency Security Scanning**: Added pip-audit to CI workflow to scan for known vulnerabilities in dependencies.
- **SBOM Generation**: Added Software Bill of Materials generation script (scripts/generate_sbom.py) and integrated it into CI.
- **Atomic Writes**: Ensured all config file writes use temp+rename pattern to prevent corruption on crash.
- **Temp File Cleanup**: Added automatic cleanup of stale .tmp files on startup.
- **Enhanced Logging**: Added context-aware logging helpers (core/context_logging.py) for better debugging.

### Changed
- **Settings Page**: Reorganized to include Language and Theme sections. Improved layout and user experience.
- **Excel Parsing**: Added file size detection and memory optimization for large files. Added workbook.close() to free memory after parsing.
- **Config Persistence**: Added language and theme fields to config.json. Updated get_settings() and save_settings() to handle these fields.

### Fixed
- **Language Toggle**: Fixed missing UI dropdown and persistence for language setting. The i18n system was complete but not wired to the Settings UI.

[Unreleased]: https://github.com/sfkareem/tawreed/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/sfkareem/tawreed/releases/tag/v0.0.1
