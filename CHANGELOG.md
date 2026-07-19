# Changelog

All notable changes to Tawreed are documented here. Versions follow Semantic
Versioning.

## [0.2.0] - 2026-07-19

### Added

- Linux x64 AppImage and Debian packages.
- Universal macOS package for Intel and Apple Silicon.
- Native package builds and verification in cross-platform CI.

### Changed

- Update validation now requires the exact release package for the running OS.
- Codex CLI discovery now supports executables installed on the Linux and macOS
  `PATH`; automatic Codex installation remains Windows-only.
- Release checksums and GitHub provenance now cover every platform package.

## [0.1.0] - 2026-07-19

### Added

- Dynamic Excel BOQ ingestion without a fixed workbook template.
- Searchable PDF extraction and local English/Arabic OCR for scanned PDFs.
- Grounded document analysis and optional Codex or Anthropic enhancement.
- Revision-controlled master and standalone work-package workbook generation.
- Local run history, direct workbook opening, and project output folders.
- Bilingual English/Arabic interface with RTL support.
- Secure GitHub release checks at startup and from the About view.
- Reproducible Windows CI, release checksums, and build provenance.

### Changed

- Replaced the previous Python/PySide and embedded-sidecar implementations with
  a root-level React, TypeScript, Tauri 2, and Rust application.

[0.1.0]: https://github.com/sfkareem/tawreed/releases/tag/v0.1.0
[0.2.0]: https://github.com/sfkareem/tawreed/releases/tag/v0.2.0
