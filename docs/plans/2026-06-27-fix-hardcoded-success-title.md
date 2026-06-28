# Fix Hard-coded "Success" Title in Settings Page

## Problem
Line 502 in `gui/pages/settings_page.py` contains a hard-coded "Success" string in a QMessageBox title, which breaks the i18n consistency.

## User Impact
- Mixed-language UI when using Arabic mode
- Inconsistent translation coverage
- Violates the project's i18n completeness standard

## Target Behavior
- Replace hard-coded "Success" with `self._i18n.tr("success_title")`
- Add "success_title" translation key to both English and Arabic dictionaries
- Add regression test to prevent future hard-coded message box titles

## Files to Touch
- `gui/pages/settings_page.py` - Replace hard-coded string
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
- Revert the single line change in settings_page.py
- Remove the new translation keys
- Remove the new test

## Acceptance Criteria
- No hard-coded "Success" string in settings_page.py
- Translation key exists in both languages
- Test passes in both English and Arabic modes
- All existing tests still pass

## Test Plan
1. Add translation keys to i18n.py
2. Replace hard-coded string in settings_page.py
3. Add regression test
4. Run full test suite
5. Manual verification in both languages

## Scope Control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves UI consistency and translation completeness, which directly supports the bilingual user experience for Arabic/English BOQ processing.
