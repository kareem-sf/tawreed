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
`PackagingDraft`, BOQ rows, and category mapping remain inside `BOQProcessor`.
Approving the token exports the stored mapping.

## Modules

- `core/excel.py` parses and writes Excel workbooks.
- `core/ai.py` validates provider responses and item coverage.
- `core/codex_connector.py` uses an existing Codex ChatGPT session without
  reading its token.
- `core/packaging_agent.py` enforces legal state transitions and approval.
- `core/db.py` stores settings and run history locally.
- `gui/worker.py` coordinates the bounded run and owns the private draft.
- `gui/run_contracts.py` contains row-free UI contracts.
- `gui/pages/workspace_page.py` renders the state-driven Workbench.
- `gui/pages/history_page.py` uses `QListView`/`QAbstractListModel` for Runs.
- `gui/pages/settings_page.py` provides staged provider/model/appearance changes.

## Safety boundaries

- No arbitrary agent tools, shell access, or model-directed file access.
- AI receives bounded JSON batches and must return the exact requested IDs.
- Export cannot start without the current opaque approval token.
- API keys use the OS keyring; Codex credentials are never copied.
- Raw BOQ content, AI JSON, output paths, and logs are not rendered in Tawreed.

## UI architecture

The main shell is a top bar plus a `QStackedWidget`. Every long page is hosted
inside a resizable `QScrollArea`. Semantic palette tokens support Light, Dark,
System, and High Contrast colors. Qt layouts, visible focus, accessible labels,
status events, RTL direction, and reduced-motion checks are shared constraints.
