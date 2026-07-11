# Tawreed 0.0.1 Deep Cleanup and Rail UI

The approved desktop concept is the visual source of truth. Tawreed retains its
native Windows frame, unchanged logo and icon, and moves all application
navigation into a persistent 220-pixel rail.

## Delivered structure

- Typed settings snapshots with merge-only section updates.
- Independent AI Connection, Model, Appearance, and Language Apply actions.
- UI-independent connection, streaming, and BOQ processing services.
- Shared row-free run contracts with compatibility facades.
- Separate provider and desktop translation catalogs.
- Shared layout tokens and reusable page, section, and navigation components.

## Visual contract

- White canvas, 48-pixel gutters, 1040-pixel content width.
- 720 by 168-pixel Workbench drop zone on wide layouts.
- Workbench hint is exactly `Supported file: .xlsx`.
- Open Settings bands with explicit separators and one Apply action per section.
- Responsive layouts from 960 by 680 through 1920 by 1080, complete Arabic RTL,
  visible focus, High Contrast, high-DPI, and reduced-motion handling.

## Compatibility contract

BOQ parsing, categorization validation, workbook formulas and formatting,
provider behavior, OS-keyring storage, local history, and established public
imports remain backward compatible for the 0.0.1 release.
