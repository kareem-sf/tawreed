# Final Hard-coded Strings Cleanup

**Date:** 2026-06-28
**Priority:** High (completes i18n work)
**Risk:** Low (UI text only)

## Problem

The i18n system is almost complete, but there are still a few hard-coded English strings in the codebase that prevent Arabic users from seeing a fully translated UI:

1. Missing translation keys: `app_tagline`, `output_file_suffix`
2. Docstring examples in `chrome.py` use literal English strings
3. Worker fallback strings use hard-coded English when i18n is None

## User Impact

Arabic-speaking users see mixed English/Arabic UI, particularly in error conditions and output filenames. This breaks the professional, localized experience.

## Target Behavior

- All UI strings go through `i18n.tr()`
- Arabic users see 100% Arabic UI
- English users see 100% English UI
- No hard-coded strings remain in the codebase

## Files to Touch

- `core/i18n.py`: Add missing translation keys
- `gui/widgets/chrome.py`: Update docstring examples
- `gui/worker.py`: Replace hard-coded fallback strings
- `tests/test_final_i18n_cleanup.py`: Add regression tests

## Risk Assessment

- **Level:** Low
- **Possible failure:** None (no functional changes)
- **Mitigation:** N/A
- **Rollback:** Simple revert

## Acceptance Criteria

- [ ] All hard-coded strings replaced with i18n calls
- [ ] Arabic translations added for new keys
- [ ] Regression tests pass
- [ ] Existing tests still pass
- [ ] No functional behavior changes

## Test Plan

```bash
pytest tests/test_final_i18n_cleanup.py -v
pytest -q
ruff check .
ruff format --check .
python -m compileall .
```

## Rollback Plan

If any issue arises, revert the single commit. No migration or cleanup needed.

## Scope Control

This PR stays within Tawreed's BOQ-to-work-package mission because it only improves internationalization and accessibility without changing any functionality or adding new features.