# Tawreed Desktop

This directory contains the production React/TypeScript interface and Tauri 2
host. Python remains the source of truth for BOQ parsing, classification,
validation, Excel generation, history, and credentials; Rust supervises that
engine and provides a narrow OS boundary.

## Runtime boundary

- Mantine owns the component system and accessible primitives.
- XState owns the explicit BOQ workflow transitions.
- Zod validates every message received by the webview.
- Rust accepts an allowlist of versioned commands and enforces payload limits.
- PyInstaller freezes the engine, and Rust embeds it into the portable host.

At runtime the host writes the engine into a unique user-private temporary
directory, starts it without a shell, and removes it on exit. The webview never
receives raw BOQ rows, prompts, model reasoning, or API keys.

## Local development

From the repository root, install the Python engine first. Then:

```powershell
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop tauri:dev
```

For browser-only visual work, `pnpm --dir desktop dev` uses a deterministic mock
engine and performs no provider calls or workbook writes.

## Verification

```powershell
python -m pytest --timeout=90
pnpm --dir desktop check
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
pnpm --dir desktop tauri:build
```

Build only the embedded payload with `python scripts/build_sidecar.py`.

## Portable-only distribution

Releases contain one native file per operating system:

- `Tawreed-Windows-x64.exe`
- `Tawreed-Linux-x64.AppImage`
- `Tawreed-macOS-<architecture>`

No installer, package, disk image, ZIP, or tar archive is generated or uploaded.
The default Tauri bundle target list is empty, normal builds use `--no-bundle`,
and `scripts/check_portable_release.mjs` rejects policy regressions.

Each platform needs its own native executable. The macOS raw Mach-O file is the
tradeoff required by the one-file, no-archive policy and must be made executable
after download. Production distribution should still add platform signing and
macOS notarization.
