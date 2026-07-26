# Tawreed

Tawreed is a cross-platform desktop application that converts construction BOQs into
validated, revision-controlled procurement work packages. It reads dynamic
Excel layouts and searchable or scanned PDF documents without requiring a
fixed template.

## Capabilities

- Reads `.xlsx`, `.xls`, `.csv`, and `.ods` workbooks plus searchable or scanned
  PDFs.
- Detects BOQ tables, project names, quantities, units, and relevant comments.
- Runs English and Arabic OCR locally with bundled Tesseract assets.
- Groups quantified scope into traceable procurement work packages.
- Runs a visible, cancellable agent workflow with explicit approval before any
  BOQ content is sent to Codex or Anthropic.
- Learns approved project-specific package mappings locally while preserving
  deterministic quantities and source citations.
- Supports item-level human review, edits, audit traces, offline routing, and
  retry-safe revision publication.
- Produces a master workbook and standalone package workbooks under atomic
  project revisions.
- Keeps settings, history, logs, and generated output under `~/.tawreed`.
- Checks the latest stable GitHub release at startup and from About.

Source quantities remain authoritative. AI may organize grounded source rows,
but Tawreed does not allow it to invent item codes, quantities, project names,
or comments.

## Download

The supported release packages are:

- Windows x64: `Tawreed-Windows-x64.exe`
- Linux x64: `Tawreed-Linux-x64.AppImage` or `Tawreed-Linux-x64.deb`
- macOS Intel and Apple Silicon: `Tawreed-macOS-universal.dmg`

Download them from [GitHub Releases](https://github.com/kareem-sf/tawreed/releases).
Release packages do not use commercial platform signing, so Windows SmartScreen
or macOS Gatekeeper may display a warning. Each release includes SHA-256
checksums and GitHub build provenance. See
[Installation](docs/INSTALL.md) before running the application.

## Privacy

Workbook parsing, PDF extraction, OCR, deterministic classification, workbook
generation, and history storage run locally. BOQ content leaves the machine
only after the user explicitly approves a Codex or Anthropic request. Anthropic
keys use the operating system credential store when available. Update checks
make an unauthenticated request to the GitHub Releases API. See
[Privacy](docs/PRIVACY.md).

## Development

Requirements:

- Windows x64, Linux x64, or macOS 12+ on Intel or Apple Silicon
- Node.js 24
- Rust 1.88+ (CI uses 1.97.0) with the target for the current platform
- Platform-native Tauri build dependencies documented by Tauri

```powershell
npm ci
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- build --no-bundle --ci -- --locked
npm audit --audit-level=high --omit=dev
cargo install cargo-audit --locked && cargo audit -f src-tauri/Cargo.lock
```

Run the desktop application during development with `npm run tauri -- dev`.

## Repository Layout

```text
engine/       BOQ ingestion, document intelligence, classification, validation
src/          React desktop interface and Web Worker integration
shared/       Shared TypeScript contracts
tests/        Vitest regression tests and synthetic fixtures
public/       Pinned OCR and PDF.js runtime assets
src-tauri/    Rust host, persistence, AI bridges, and update security boundary
scripts/      Version and vendor-integrity checks
docs/         Architecture, installation, privacy, and release guidance
```

Marketing video projects and generated media are intentionally excluded from
this repository.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALL.md)
- [Privacy](docs/PRIVACY.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Release process](docs/RELEASING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Tawreed is licensed under the [MIT License](LICENSE). Copyright 2026 Kareem
Safwat.
