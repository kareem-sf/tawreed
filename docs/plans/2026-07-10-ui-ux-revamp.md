# Tawreed 0.0.1 UI/UX Revamp

## Decision

Keep PySide6/Qt Widgets and the existing logo/icon. Use the approved fixed left
navigation rail and open, disciplined page layouts for a minimal agent workflow.

## Implemented product

- 220-pixel left rail with Workbench, Runs, Settings, and About.
- State flow: Empty, Ready, Inspecting, Structuring, Classifying, Validating,
  Approval, Exporting, Complete, and Error.
- Row-free `RunProgress` and `ApprovalSummary` contracts.
- Opaque approval token; the processor retains the full draft privately.
- Count-only summary approval before workbook export.
- Runs implemented with `QListView` and `QAbstractListModel`.
- Independent Settings sections with live provider model discovery.
- Semantic Light/Dark/System palettes, RTL, High DPI, visible focus,
  accessibility announcements, High Contrast, and reduced-motion handling.

## Acceptance

- No BOQ rows, spreadsheet previews, data tables, raw AI JSON, raw output paths,
  or visible logs.
- Approval remains mandatory.
- Existing parser, provider, security, history, and workbook contracts remain
  verified.
- Release version is reset to `0.0.1` and distributed as portable binaries.
