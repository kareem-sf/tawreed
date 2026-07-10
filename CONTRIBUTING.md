# Contributing

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

## Required checks

```powershell
pre-commit run --all-files
ruff check .
ruff format --check .
pytest -q --timeout=90
pyinstaller --noconfirm --clean tawreed.spec
```

Mock provider calls in automated tests. Add regression coverage for every
behavior change. UI changes must test English/Arabic, keyboard focus, and the
absence of BOQ rows/raw output in the interface.

## Pull requests

Branch from `master`, keep one coherent scope, and wait for the Windows/Linux
Python matrix and wheel smoke test. Never commit secrets, generated workbooks,
or build output.

## Release

`pyproject.toml` is the version source. A `vX.Y.Z` tag runs
`.github/workflows/release.yml`, which builds and publishes only the three
portable binaries. Release `0.0.1` is the first public version.
