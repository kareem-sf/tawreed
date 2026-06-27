# Fix Hard-coded "File missing" Title in Workspace Page

## Problem
Lines 489 and 511 in `gui/pages/workspace_page.py` contain hard-coded "File missing" strings in QMessageBox titles, which breaks the i18n consistency.

## User Impact
- Mixed-language UI when using Arabic mode
- Inconsistent translation coverage
- Violates the project's i18n completeness standard

## Target Behavior
- Replace hard-coded "File missing" with `self._i18n.tr("file_missing_title")`
- Add "file_missing_title" and "file_missing_message" translation keys to both English and Arabic dictionaries
- Add regression test to prevent future hard-coded message box titles

## Files to Touch
- `gui/pages/workspace_page.py` - Replace hard-coded strings
- `core/i18n.py` - Add translation keys
- `tests/test_hardcoded_strings_fix.py` - Add regression test

## Risk Level
Low risk:
- Small, isolated change
- Existing tests cover i18n functionality
- Change is behavior-preserving (same functionality, just translated)

## Possible Failure
- Missing translation key could cause KeyError
- Mitigation: Add the key before changing the code

## Rollback
- Revert the two line changes in workspace_page.py
- Remove the new translation keys
- Remove the new test

## Acceptance Criteria
- No hard-coded "File missing" strings in workspace_page.py
- Translation keys exist in both languages
- Test passes in both English and Arabic modes
- All existing tests still pass

## Test Plan
1. Add translation keys to i18n.py
2. Replace hard-coded strings in workspace_page.py
3. Add regression test
4. Run full test suite
5. Manual verification in both languages

## Scope Control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves UI consistency and translation completeness, which directly supports the bilingual user experience for Arabic/English BOQ processing.