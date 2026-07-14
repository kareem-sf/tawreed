# Tawreed 0.1

## Product boundary

Input: one construction BOQ `.xlsx` workbook.

Output: one generated `.xlsx` workbook grouped into bounded construction work
packages.

The desktop UI is intentionally not an Excel editor. It exposes workflow
progress, package counts, warnings, provider/model metadata, approval, and local
run history. BOQ rows and raw provider output stay inside the engine.

## Release definition

- React/TypeScript UI using Mantine and XState.
- Tauri 2 host with a narrow Rust command allowlist.
- Embedded headless Python engine; no Python installation required by users.
- English/Arabic, LTR/RTL, Light/Dark/System, and accessible keyboard behavior.
- Direct portable executables only; installers and archives are forbidden.
- Version `0.1.0` across Python, Node, Rust, Tauri, workbook metadata, and tags.

## Quality gates

- Ruff and the complete headless pytest suite.
- React lint, unit tests, TypeScript compilation, and production build.
- Rust formatting and cross-platform Tauri compilation.
- Fresh native sidecar build on Windows, Linux, and macOS.
- Portable-release policy validation.
- Remotion lint, TypeScript validation, and bundle compilation.
