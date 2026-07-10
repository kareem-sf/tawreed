# Tawreed 0.0.1

## Product boundary

Input: one BOQ `.xlsx` workbook.

Output: one generated `.xlsx` workbook grouped into construction work packages.

The desktop UI is intentionally not an Excel editor. It exposes progress,
package counts, warnings, provider/model metadata, and an approval action. BOQ
rows and the complete packaging draft remain private to the processor.

## Release definition

- Native PySide6/Qt Widgets application.
- Codex ChatGPT login is the default provider; models are fetched live.
- Summary approval is mandatory before export.
- English/Arabic, LTR/RTL, Light/Dark/System, High Contrast, and 100–200% scale.
- Portable one-file binaries only.
- Version `0.0.1` in code, UI, workbook metadata, and GitHub.

## Quality gates

- Full pytest and Ruff checks.
- Clean wheel install.
- Clean PyInstaller one-file build.
- Real ARCH BOQ parses at 97 and 106 items.
- Real Codex Spark generation for both BOQs.
- Workbook count, formula, and visual checks.
- Keyboard, focus, Narrator, RTL, appearance, scaling, and reduced-motion checks.
