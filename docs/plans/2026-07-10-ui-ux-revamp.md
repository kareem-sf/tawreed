# Tawreed 0.0.1 UI/UX Revamp

## Decision

Keep PySide6/Qt Widgets and the existing logo/icon. Replace the fixed sidebar,
card-heavy pages, visible console, history table, and editable review grid with
a minimal agent workflow.

## Implemented product

- Top bar with Workbench, Runs, and a compact Settings/About menu.
- State flow: Empty, Ready, Inspecting, Structuring, Classifying, Validating,
  Approval, Exporting, Complete, and Error.
- Row-free `RunProgress` and `ApprovalSummary` contracts.
- Opaque approval token; the processor retains the full draft privately.
- Count-only summary approval before workbook export.
- Runs implemented with `QListView` and `QAbstractListModel`.
- Staged Settings with live provider model discovery.
- Semantic Light/Dark/System palettes, RTL, High DPI, visible focus,
  accessibility announcements, High Contrast, and reduced-motion handling.

## Acceptance

- No BOQ rows, spreadsheet previews, data tables, raw AI JSON, raw output paths,
  or visible logs.
- Approval remains mandatory.
- Existing parser, provider, security, history, and workbook contracts remain
  verified.
- Release version is reset to `0.0.1` and distributed as portable binaries.
