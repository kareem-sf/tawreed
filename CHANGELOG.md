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

[Unreleased]: https://github.com/sfkareem/tawreed/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/sfkareem/tawreed/releases/tag/v0.0.1
