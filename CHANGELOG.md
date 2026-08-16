# Changelog

All notable changes to Tawreed are documented here. Versions follow Semantic
Versioning.

## 0.5.3 (2026-08-16)

## What's Changed
* fix(a11y): honor focus and reduced-motion preferences by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/50


**Full Changelog**: https://github.com/kareem-sf/tawreed/compare/v0.5.2...v0.5.3

## 0.5.2 (2026-08-16)

## What's Changed
* fix(security): remediate production dependency advisories by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/44


**Full Changelog**: https://github.com/kareem-sf/tawreed/compare/v0.5.1...v0.5.2

## 0.5.1 (2026-07-28)

## What's Changed
* fix: repair automated releases and TypeScript 5.9 by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/31


**Full Changelog**: https://github.com/kareem-sf/tawreed/compare/v0.5.0...v0.5.1

## 0.5.0 (2026-07-27)

## What's Changed
* Simplify onboarding, provider setup, and work-package review by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/29


**Full Changelog**: https://github.com/kareem-sf/tawreed/compare/v0.4.1...v0.5.0

## 0.4.1 (2026-07-27)

## What's Changed
* fix(ci): finalize token-merged releases by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/21
* fix(ci): prioritize release asset publication by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/23
* fix(ci): detect quarantined pull request runs by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/24
* fix(ci): publish draft releases by id by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/25
* fix(ci): aggregate protected release checks by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/26
* fix(ci): capture dispatched release run directly by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/27
* fix(ci): use the pushed release commit SHA by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/28


**Full Changelog**: https://github.com/kareem-sf/tawreed/compare/v0.4.0...v0.4.1

## 0.4.0 (2026-07-27)

## What's Changed
* feat: universal workbook ingestion (xls, csv, ods, corrupt, protected) by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/14
* Harden agentic BOQ workflow by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/15
* ci: automate versioned desktop releases by @kareem-sf in https://github.com/kareem-sf/tawreed/pull/19


**Full Changelog**: https://github.com/kareem-sf/tawreed/compare/v0.3.0...v0.4.0

## [0.3.0] - 2026-07-20

### Added

- Fully dynamic work packaging: the AI now derives the procurement packages
  from each BOQ (per project) instead of sorting items into a fixed list.

### Changed

- AI classification proposes a project-specific package structure first, then
  assigns every item to it, so packages stay consistent within a project.
- The offline keyword/grouping classifier is now the no-AI fallback only.
- Renamed the provider-agnostic classifier module to reflect that it supports
  any LLM provider, not a single vendor.

### Fixed

- AI enhancement on the API-key path now uses an approved model, so the
  classifier actually runs instead of silently falling back.

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

[0.1.0]: https://github.com/kareem-sf/tawreed/releases/tag/v0.1.0
[0.2.0]: https://github.com/kareem-sf/tawreed/releases/tag/v0.2.0
[0.3.0]: https://github.com/kareem-sf/tawreed/releases/tag/v0.3.0
