# Contributing

## Setup

Install Python 3.12, Node.js 24, pnpm 11, Rust stable, and the official Tauri 2
system prerequisites. Then run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
pnpm --dir desktop install --frozen-lockfile
pnpm --dir marketing-video install --frozen-lockfile
pre-commit install
```

## Required checks

```powershell
python -m ruff check .
python -m ruff format --check .
python -m pytest --timeout=90
pnpm --dir desktop check
pnpm --dir marketing-video check
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
python scripts/build_sidecar.py
pnpm --dir desktop tauri:build
```

Mock provider calls in automated tests. Add regression coverage for behavior
changes. UI changes must verify keyboard focus, English/Arabic layout, and the
rule that BOQ rows and raw model output are never rendered.

## Pull requests and releases

Keep each change coherent and do not commit secrets, BOQ workbooks, generated
media, binaries, or build output. A `desktop-vX.Y.Z` tag runs the portable
release workflow. It may publish only one direct executable per platform; do
not introduce installers or compressed release assets.
