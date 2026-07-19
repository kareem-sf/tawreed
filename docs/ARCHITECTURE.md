# Architecture

## Overview

Tawreed is a local-first React application embedded in a Tauri 2 Windows host.
The frontend performs document processing in Web Workers while Rust owns local
storage, privileged filesystem operations, external processes, HTTPS provider
calls, and update validation.

```text
React UI
  -> BOQ Web Worker
     -> ExcelJS ingestion or PDF.js extraction
     -> local Tesseract OCR when required
     -> deterministic document intelligence
     -> grounded optional AI refinement
     -> package validation and workbook generation
  -> typed Tauri bridge
     -> Rust commands
        -> ~/.tawreed storage and SQLite history
        -> Anthropic HTTPS or official Codex CLI
        -> constrained file and URL opening
        -> GitHub release validation
```

## Frontend

`src/App.tsx` owns the workflow and modal state. Heavy workbook and PDF work is
routed through `src/workers/boq.worker.ts`. Engine modules are UI-independent
and covered by Node-based Vitest tests.

`engine/ingest.ts` discovers spreadsheet structure and normalizes quantified
rows. `engine/pdf-ingest.ts` reconstructs searchable PDF tables or runs local
OCR. `engine/document-intelligence.ts` detects grounded project and comment
metadata. Classification combines deterministic rules with optional AI, then
`engine/generate.ts` creates the master and package workbooks.

## Rust Host

The Rust host exposes only commands registered in `src-tauri/src/main.rs`.
`commands.rs` validates local paths and controls workbook publication.
`store.rs` manages `~/.tawreed`, SQLite history, settings, logs, and API-key
resolution. `codex.rs` integrates the official Codex CLI. `update.rs` validates
the latest stable release and constructs a fixed official download URL.

## Persistence

Runtime data is outside the installation directory:

```text
~/.tawreed/
  .env
  settings.json
  history.sqlite
  logs/app.log
  output/<project>/Rev XX/
  bin/codex.exe
```

Revision publication uses a hidden temporary directory and a final atomic
rename so an interrupted generation is not exposed as a completed revision.

## Security Model

- The webview CSP permits local application assets and Tauri IPC, not direct
  internet access.
- Rust performs remote requests through rustls.
- File-opening commands restrict targets to generated Tawreed output.
- External URLs require HTTPS and an approved host.
- Update tags must be canonical stable semantic versions and contain exactly
  one expected Windows executable asset.
- AI output is reconciled against source identifiers rather than treated as a
  source of new BOQ facts.

## Platform Scope

The current supported release is Windows x64. The Codex downloader and release
artifact are Windows-specific. Linux and macOS should not be advertised until
their native paths, OCR behavior, signing, packaging, and release tests are
implemented.
