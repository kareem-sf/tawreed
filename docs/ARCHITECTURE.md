# Architecture

Tawreed is one Tauri desktop application with three deliberate layers:

```text
React + TypeScript webview
          │ versioned commands and events
          ▼
Thin Rust/Tauri host
          │ JSON Lines over private stdin/stdout
          ▼
Embedded headless Python engine
          │
          ├─ provider APIs or the user's Codex session
          ├─ local SQLite/settings/keyring
          └─ input and generated .xlsx files
```

## Desktop layer

`desktop/src` owns presentation only. Mantine supplies the design system,
XState owns the workflow state machine, Zod validates engine payloads, and
i18next handles English/Arabic direction and copy. The UI receives summaries,
progress, and opaque approval tokens, never BOQ row data or raw model output.

`desktop/src-tauri` is intentionally small. It embeds the frozen engine, writes
it to a user-private temporary directory, starts it, validates command names and
payload sizes, forwards versioned events, and removes the temporary process
files on shutdown. Tauri's single-instance plugin owns desktop-instance
coordination.

## Engine layer

- `tawreed_engine/protocol.py` defines the versioned JSON-lines envelope.
- `tawreed_engine/service.py` owns command dispatch and one active run.
- `core/processing_pipeline.py` orchestrates parse, classification, validation,
  approval, export, and history.
- `core/packaging_agent.py` enforces legal workflow transitions and exact item
  coverage.
- `core/excel.py` parses and writes workbooks.
- `core/ai.py`, `core/provider_registry.py`, `core/model_catalog.py`, and
  `core/codex_connector.py` own bounded provider integration.
- `core/db.py` owns non-secret settings, keyring-backed credentials, history,
  and output paths.
- `core/i18n.py` contains only engine/workbook translations and has no UI
  framework dependency.

## Approval boundary

The model classifies bounded JSON batches and must return exactly the requested
item IDs. The complete draft stays inside `BOQProcessingPipeline`. The frontend
receives an `ApprovalSummary` and an opaque token. Export is impossible until
that current token is returned, and cancellation invalidates it.

## Packaging boundary

`scripts/build_sidecar.py` freezes the Python engine for the current target
triple. Tauri's Rust build embeds those bytes directly, so the published host
is one file. Standard builds use `--no-bundle`; Linux releases explicitly build
one AppImage. `scripts/check_portable_release.mjs` rejects installer targets,
archives, stale package output, and workflow artifact indirection.
