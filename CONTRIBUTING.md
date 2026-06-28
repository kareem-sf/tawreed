# Contributing

Thanks for your interest in Tawreed. The project is small and the
contribution model is intentionally simple.

## Setup

```bash
git clone https://github.com/sfkareem/tawreed
cd tawreed
python -m venv .venv
. .venv/Scripts/activate      # Windows
# . .venv/bin/activate        # macOS / Linux
pip install -e ".[dev]"
```

## Run

```bash
python main.py
```

## Test

```bash
pytest -q
```

To run the optional end-to-end regression test against a real BOQ:

```bash
TAWREED_TEST_BOQ="C:/path/to/a/real/boq.xlsx" pytest -q
```

### Testing Guidelines

- **All new features require tests** - Add tests for any new functionality
- **Bug fixes require regression tests** - Tests should fail on `master` and pass on your branch
- **Mock AI calls** - Never make live API calls in tests
- **Test edge cases** - Consider invalid inputs, network failures, permission errors
- **Keep tests fast** - Tests should run in milliseconds, not seconds
- **Test both English and Arabic** - Ensure i18n works correctly

### Running Specific Tests

```bash
# Run tests for a specific module
pytest tests/test_excel_parsing.py -v

# Run tests matching a pattern
pytest -k "i18n" -v

# Run with coverage
pytest --cov=core --cov=gui
```

## Architecture

Tawreed follows a clean, modular architecture with clear separation of concerns:

- **GUI Layer** (`gui/`): PySide6/Qt presentation layer
- **Core Layer** (`core/`): Business logic (no Qt dependencies)
- **Storage Layer**: SQLite database and OS keyring
- **AI Layer**: Multi-provider LLM integration

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation including:
- Component diagrams
- Data flow diagrams
- Design principles
- Technical stack overview

## Pull requests

- One change per PR. Split unrelated changes into separate PRs.
- Branch from `master` with a descriptive name:
  `feat/...`, `fix/...`, `chore/...`, `docs/...`, `test/...`.
- Squash-merge to `master` with a descriptive commit message
  (this repo uses `gh pr merge --squash --delete-branch`).
- All PRs run the CI matrix (Ubuntu + Windows, Python 3.10/3.11/3.12)
  before they can be merged.
- Add a test for any behaviour change. Bug fixes should include a
  regression test that fails on `master` and passes on the branch.

## Coding style

- Python 3.10+. No walrus abuse, no match/case where a plain `if` is
  clearer. Use type hints on public functions.
- Logging via `logging.getLogger(__name__)`, never `print()`.
- No new top-level `print()` statements. If you need a startup
  message before logging is configured, use `sys.stderr.write()`.
- Never commit API keys, tokens, or any secret. The pre-commit
  hooks (`.pre-commit-config.yaml`) block commits that contain
  known-secret patterns.

## Project layout

See [README.md](README.md#project-structure) for the full tree. In
short: backend code in `core/`, Qt code in `gui/`, tests in `tests/`,
console entry in `tawreed_app/`.

## Release process

1. Cut a feature freeze branch.
2. Bump the version in `pyproject.toml` and `tawreed_app/__init__.py`
   (the splash imports the version from the latter, so they should
   never drift).
3. Tag `vX.Y.Z` and push — `.github/workflows/release.yml` builds
   Windows / macOS / Linux artifacts and attaches them to the
   GitHub release.
4. Edit the GitHub release notes from the auto-generated draft.

## Documentation Updates

When contributing, please update relevant documentation:

- **New features**: Update README.md and add to CHANGELOG.md
- **Architecture changes**: Update ARCHITECTURE.md
- **API changes**: Update relevant docstrings
- **Bug fixes**: Add to CHANGELOG.md under appropriate version

## Questions?

Open an issue or email kareem@kareemsafwat.com.
