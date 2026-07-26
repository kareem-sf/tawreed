# Architecture

## Overview

Tawreed is a local-first React application embedded in a Tauri 2 desktop host
for Windows, Linux, and macOS.
The frontend performs document processing in Web Workers while Rust owns local
storage, privileged filesystem operations, external processes, HTTPS provider
calls, and update validation.

```text
React UI
  -> BOQ Web Worker
     -> ExcelJS ingestion or PDF.js extraction
     -> local Tesseract OCR when required
     -> deterministic document intelligence
     -> explicit external-provider consent gate
     -> grounded optional AI refinement or offline policy route
     -> local project memory + human item review
     -> package validation and workbook generation
  -> typed Tauri bridge
     -> Rust commands
        -> ~/.tawreed storage and SQLite history
        -> Anthropic HTTPS or official Codex CLI
        -> constrained file and URL opening
        -> GitHub release validation
```

## Frontend

`src/App.tsx` owns the staged workflow, cancellation, consent, review, and modal
state. Heavy workbook and PDF work is routed through `src/boq-worker.ts`.
`engine/agent-workflow.ts` defines typed audit events, approved-memory
application, and revision-safe human edits. Engine modules are UI-independent
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
resolution and native credential storage. `codex.rs` uses the official Codex
app-server `model/list` method for discovery and `codex exec` for bounded
one-shot jobs. Jobs use ephemeral sessions, an empty temporary working
directory, ignored user configuration and repository rules, read-only
sandboxing, response schemas, cancellation, timeouts, and bounded output.
`update.rs` validates the latest stable release and constructs a fixed official
download URL.

## Persistence

Runtime data is outside the installation directory:

```text
~/.tawreed/
  .env                    # credential fallback only
  settings.json
  history.sqlite
  logs/app.log
  output/<project>/Rev XX/
  bin/codex[.exe]
```

Anthropic credentials normally live in the platform credential manager. The
SQLite database contains immutable run audit metadata and approved,
project-scoped package mappings. Revision publication uses a hidden temporary
directory and a final atomic rename so an interrupted generation is not
exposed as a completed revision; a failed final rename remains retryable
without rebuilding the workbooks.

## Security Model

- The webview CSP permits local application assets and Tauri IPC, not direct
  internet access.
- Rust performs remote requests through rustls.
- File-opening commands restrict targets to generated Tawreed output.
- External URLs require HTTPS and an approved host.
- Update tags must be canonical stable semantic versions and contain exactly
  one expected package for the running platform.
- AI output is reconciled against source identifiers rather than treated as a
  source of new BOQ facts.
- Quantities, units, item identifiers, and citations remain authoritative
  deterministic data; AI can only propose grounded package assignments.
- External AI requires a visible per-file consent step, and offline operation
  remains a first-class route.
- Every stage emits an audit event saved with provider, model, and memory use in
  the run history.

## Platform Scope

Supported packages are Windows x64, Linux x64, and universal macOS for Intel and
Apple Silicon. CI compiles and packages every target. Windows receives a
portable executable, Linux receives AppImage and Debian packages, and macOS
receives an ad-hoc-signed universal DMG. Commercial Windows signing and Apple
Developer ID notarization are not currently configured. Codex is discovered on
`PATH` on every platform; managed Codex download remains Windows-only.
