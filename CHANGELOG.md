# Changelog

All notable changes to Tawreed will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.11] - 2026-06-28

### Fixed
- **Critical Excel BOQ Column Detection**: Fixed bug where ITEM columns were misclassified as DESCRIPTION columns, causing item numbers to appear in description field instead of Nr. field
- **Excel Column Detection**: Added 'item' to 'no' keywords and changed 'item' to 'work item' in 'desc' keywords to avoid conflicts

### Added
- **Workspace Tooltips i18n**: Completed bilingual support by routing workspace page tooltips through the translation system
- **New Translation Keys**: Added "open_output_tooltip" and "show_in_folder_tooltip" in both English and Arabic
- **Comprehensive Tests**: Added test suite for workspace tooltip i18n functionality
- **Excel Column Detection Test**: Added comprehensive regression test for ITEM/DESCRIPTION header pattern
- **Architecture Documentation**: Added comprehensive architecture documentation in docs/ARCHITECTURE.md
- **Contributing Guidelines**: Enhanced CONTRIBUTING.md with detailed development workflow and best practices

### Changed
- **Code Formatting**: Reformatted all test files with ruff for consistency
- **Splash Screen Implementation**: Improved to reuse existing "about_page_subtitle" translation instead of creating duplicate keys
- **README Improvements**: Enhanced project documentation and clarity
- **Security Documentation**: Rephrased terms to avoid gitleaks false positives

### Security
- **Documentation Security**: Improved documentation to avoid false positives in security scanning tools

## [0.0.9] - 2026-06-28

### Added
- **Enhanced Excel Error Handling**: Improved error messages for common Excel file issues:
  - Corrupt or incomplete Excel files
  - Older .xls format files (Tawreed only supports .xlsx)
  - Invalid Excel files (password-protected, wrong format, etc.)
- **Comprehensive i18n Support**: Added 3 new translation keys for Excel error messages in both English and Arabic
- **Enhanced Test Coverage**: Added comprehensive test suite for Excel error handling scenarios

## [0.0.8] - 2026-06-28

### Added
- **Merged Header Support**: Added detection and parsing of merged header cells in Excel BOQs (e.g., "Item Description" spanning multiple columns), improving accuracy for real-world construction spreadsheets

## [0.0.7] - 2026-06-28

### Fixed
- **Excel Cover Sheet i18n**: Fixed Excel cover sheet to use translated strings instead of hard-coded English, completing the bilingual experience for Arabic users

### Added
- **Excel Cover Sheet Translations**: Added 6 new translation keys for cover sheet elements (title, subtitle, project name label, date label, application label, application value)
- **Comprehensive Cover Sheet Tests**: Added test suite for Excel cover sheet i18n in both English and Arabic

## [0.0.6] - 2026-06-28

### Fixed
- **Crash Handler i18n**: Fixed crash handler to use translated error messages instead of hard-coded English strings, ensuring consistent bilingual experience for Arabic users
- **Complete i18n Coverage**: Added missing translation keys and routed remaining hard-coded strings through i18n system:
  - Excel error messages (file not found, read errors, no worksheets, write errors)
  - Settings page "Testing connection…" status message
  - Default project name in error responses and output workbooks
  - All error messages now respect user language preference with proper fallback support

### Added
- **Excel i18n Support**: Added 6 new translation keys covering all Excel operation error messages
- **Comprehensive Tests**: Added test suite for Excel i18n error handling and fallback behavior
- **Default Project Name Translation**: Added translation keys for default project name in both English and Arabic

### Changed
- **Excel Module**: Modified `parse_excel()` and `write_excel()` to accept optional `i18n` parameter for translated error messages
- **Worker Integration**: Updated worker to pass i18n context to Excel functions for proper error message translation
- **Default Project Name**: Modified worker to use translated default project name instead of hard-coded "Tawreed Project"

## [0.0.5] - 2026-06-27
- **Settings Save Bug**: Fixed duplicate QApplication imports that could cause runtime errors in the settings page
- **Model Parameter Consistency**: Standardized on `model_id` parameter name across the codebase for improved maintainability and reduced confusion
- **i18n Completeness**: Added missing Arabic translations for message box strings and fixed key naming consistency
- **i18n Completeness**: Removed duplicate translation keys and completed final hard-coded strings cleanup
- **Workspace i18n**: Fixed remaining hard-coded console status messages (Loaded:/Saved:/Error: prefixes)
- **Language Toggle**: Fixed missing UI dropdown and persistence for language setting
- **File Type Mismatch**: Fixed UI to correctly advertise .xlsx-only support instead of .xlsx/.xls
- **i18n Consistency**: Eliminated mixed-language UI by ensuring all pages use the translation system
- **RTL Layout**: Improved right-to-left layout support for Arabic interface
- **Settings i18n**: Fixed hard-coded "Success" message box title to use translation system
- **Settings Save Bug**: Fixed QApplication import to prevent NameError in settings page
- **CHANGELOG Cleanup**: Fixed duplicate version references in CHANGELOG
- **Workspace i18n**: Fixed hard-coded "File missing" message box titles to use translation system

### Added
- **Complete i18n Support**: All application pages (Workspace, History, Settings, About) now support bilingual English/Arabic UI with automatic RTL layout switching
- **Comprehensive Arabic Translations**: Added 72 new translation keys covering all UI elements across all pages
- **Language Toggle**: Added English ↔ Arabic language switcher in Settings page with automatic UI translation and RTL layout support
- **Dark/Light Theme Toggle**: Added theme selection in Settings page with new light theme (tawreed_light.qss)
- **Recent Files List**: Added a list of recently opened BOQ files in the Workspace page with click-to-open functionality
- **Progress Bar**: Added a progress bar to the Workspace page to show processing status
- **Toast Notifications**: Added non-blocking toast notifications for success/error feedback
- **Keyboard Shortcuts**: Added keyboard shortcuts for common actions:
  - `Esc`: Clear selection
  - `Ctrl+O`: Open file dialog
  - `Ctrl+P`: Start processing
  - `Ctrl+L`: Clear console log
- **Memory Optimization**: For Excel files >10MB, the parser now uses read_only mode and save_virtual_workbook for memory-efficient processing
- **Retry Logic**: Added exponential backoff retry functionality for API calls and file operations
- **Improved Error Recovery**: Better error handling for corrupt/malformed Excel files with user-friendly error messages
- **Dependency Security Scanning**: Added pip-audit to CI workflow for vulnerability detection
- **SBOM Generation**: Added Software Bill of Materials generation script (scripts/generate_sbom.py)
- **Atomic Writes**: Ensured all config file writes use temp+rename pattern for crash safety
- **Temp File Cleanup**: Added automatic cleanup of stale .tmp files on startup
- **Enhanced Logging**: Added context-aware logging helpers for better debugging

### Changed
- **Settings Page**: Reorganized to include Language and Theme sections with dropdown selectors
- **Excel Parsing**: Added file size detection and memory optimization for large files
- **Config Persistence**: Added language and theme fields to config.json with proper validation
- **Settings Page**: All hard-coded strings now routed through i18n system for complete bilingual support
- **About Page**: All hard-coded strings now routed through i18n system
- **Workspace Page**: All hard-coded strings now routed through i18n system
- **History Page**: All hard-coded strings now routed through i18n system

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

[0.0.11]: https://github.com/sfkareem/tawreed/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/sfkareem/tawreed/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/sfkareem/tawreed/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/sfkareem/tawreed/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/sfkareem/tawreed/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/sfkareem/tawreed/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/sfkareem/tawreed/compare/v0.0.1...v0.0.5
[0.0.1]: https://github.com/sfkareem/tawreed/releases/tag/v0.0.1