# Fix Crash Handler i18n

## Problem
The crash handler in `main.py` (lines 56-61) uses hard-coded English strings in the QMessageBox.critical() call. This breaks i18n consistency and shows untranslated text to Arabic users.

## User Impact
Arabic users will see English error messages when the application crashes, which is inconsistent with the rest of the translated UI.

## Target Behavior
The crash handler should use translated strings from the i18n system, just like all other user-facing messages in the application.

## Files to Touch
- `main.py` - Update crash handler to use i18n
- `core/i18n.py` - Add new translation keys
- `tests/test_main_crash_i18n.py` - Add regression test

## Risk Level
Low risk - only affects error message display, no business logic changes.

## Acceptance Criteria
1. Crash handler uses translated strings
2. Arabic users see Arabic error messages on crash
3. New translation keys added to both English and Arabic dictionaries
4. Regression test passes
5. All existing tests still pass

## Test Plan
1. Run existing tests to ensure no regression
2. Add new test for crash handler i18n
3. Verify test passes
4. Manually verify Arabic translation displays correctly

## Rollback Plan
If issues arise, revert the changes to main.py and i18n.py. The crash handler will fall back to English (current behavior).

## Scope Control
This fix only addresses the crash handler i18n issue. It does not change crash handling logic, logging, or any other part of the system.