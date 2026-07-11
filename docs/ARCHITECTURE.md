# Architecture

Tawreed is a local PySide6 desktop application with a deliberately narrow agent
boundary.

## Run flow

```text
BOQ .xlsx
  -> Inspecting
  -> Structuring
  -> Classifying in bounded batches
  -> Validating exact item coverage
  -> Summary approval
  -> Workbook export
  -> Local run history
```

`RunPhase` and `RunProgress` describe the visible workflow. `ApprovalSummary`
contains only the source filename, total count, package counts, warnings,
provider, and model. The UI receives an opaque draft token. The full
`PackagingDraft`, BOQ rows, and category mapping remain inside the processing pipeline.
Approving the token exports the stored mapping.

## Modules

- `core/excel.py` parses and writes Excel workbooks.
- `core/provider_registry.py` owns provider metadata and defaults.
- `core/ai.py` validates provider responses and item coverage.
- `core/connection_service.py` validates provider connectivity.
- `core/stream_service.py` consumes the bounded categorization stream.
- `core/processing_pipeline.py` orchestrates parsing, classification, approval,
  export, and history without depending on Qt.
- `core/settings_service.py` provides typed, section-level settings updates.
- `core/run_contracts.py` contains the row-free workflow contracts.
- `core/codex_connector.py` uses an existing Codex ChatGPT session without
  reading its token.
- `core/packaging_agent.py` enforces legal state transitions and approval.
- `core/db.py` stores settings and run history locally.
- `gui/worker.py` is a thin Qt signal and compatibility adapter.
- `gui/run_contracts.py` preserves the historical import surface.
- `gui/pages/workspace_page.py` renders the state-driven Workbench.
- `gui/pages/history_page.py` uses `QListView`/`QAbstractListModel` for Runs.
- `gui/pages/settings_page.py` provides independently applied settings sections.

## Safety boundaries

- No arbitrary agent tools, shell access, or model-directed file access.
- AI receives bounded JSON batches and must return the exact requested IDs.
- Export cannot start without the current opaque approval token.
- API keys use the OS keyring; Codex credentials are never copied.
- Raw BOQ content, AI JSON, output paths, and logs are not rendered in Tawreed.

## UI architecture

The main shell is a fixed 220-pixel navigation rail plus a `QStackedWidget`.
Every long page is hosted inside a resizable `QScrollArea`. Shared spacing and
layout tokens define the 48-pixel page gutter, 1040-pixel content column, and
40–44-pixel controls. Semantic palette tokens support Light, Dark, System, and
High Contrast colors. Qt layouts, visible focus, accessible labels, status
events, RTL direction, and reduced-motion checks are shared constraints.
