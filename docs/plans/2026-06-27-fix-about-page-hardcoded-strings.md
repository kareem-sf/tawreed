# Fix About Page Hardcoded Strings

## Problem
The About page in `gui/pages/about_page.py` has three hard-coded technical stack strings that are not routed through the i18n system:
- "Python 3.10+" (line 128)
- "openpyxl · pandas · SQLite" (line 133)
- "PyInstaller (onedir)" (line 134)

These strings need to be translated for Arabic users.

## User Impact
Arabic users will see English technical terms mixed with Arabic UI, breaking the bilingual consistency.

## Target Behavior
All strings in the About page should use the i18n system so they can be properly translated to Arabic.

## Files to Touch
- `core/i18n.py` - Add new translation keys for the technical stack strings
- `gui/pages/about_page.py` - Replace hard-coded strings with i18n calls
- `tests/test_about_i18n.py` - Add regression tests

## Risk Level
Low risk - only affects UI strings, no business logic changes.

## Acceptance Criteria
1. All About page strings use i18n system
2. Arabic translations added for technical stack terms
3. Regression tests pass
4. All existing tests still pass

## Test Plan
1. Run existing tests to ensure no regression
2. Add new tests for the technical stack strings
3. Verify tests pass
4. Manual verification in both English and Arabic

## Rollback Plan
If issues arise, revert the changes to about_page.py and i18n.py. The About page will fall back to English (current behavior).

## Scope Control
This fix only addresses the remaining hard-coded strings in the About page. It does not change any other part of the system or add new features.
