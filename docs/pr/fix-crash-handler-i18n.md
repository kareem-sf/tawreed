## Summary
* Fixed crash handler to use translated error messages instead of hard-coded English strings
* Added new translation keys for crash handler messages in both English and Arabic
* Added comprehensive tests to verify crash handler i18n functionality

## User value
* Arabic users now see properly translated error messages when the application crashes
* Consistent i18n experience across the entire application
* Better user experience for non-English speakers

## Scope control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves the user experience by ensuring consistent internationalization, which is essential for a bilingual application targeting both English and Arabic construction professionals.

## What changed
* `main.py`: Updated `_excepthook` to use `get_i18n()` and translated strings
* `core/i18n.py`: Added `unexpected_error_title` and `unexpected_error_message` keys to both English and Arabic translations
* `tests/test_main_crash_i18n.py`: Added comprehensive tests for crash handler i18n functionality
* `docs/plans/2026-06-27-fix-crash-handler-i18n.md`: Added plan document

## Risk assessment
* Risk level: Low
* Possible failure: Translation keys missing or incorrect
* Mitigation: Comprehensive tests verify both English and Arabic translations work correctly
* Rollback: Revert to hard-coded English strings (current behavior before this fix)

## Dependency decision
* New dependency: no
* Library: N/A
* License: N/A
* What it replaces: Hard-coded English strings
* Why now: Completes the i18n consistency across the application
* Binary-size risk: None
* Alternatives considered: None needed - this is the standard i18n approach used throughout the codebase

## Internal team review
* Product: ✅ Improves user experience for bilingual users
* UX: ✅ Ensures consistent translation experience
* Architecture: ✅ No architectural changes
* Engineering: ✅ Clean, minimal code changes
* QA: ✅ Comprehensive tests added
* Security: ✅ No security implications
* DevOps: ✅ No deployment changes
* Docs: ✅ Plan document added

## Tests
* [x] pytest -q (151 passed, 3 skipped)
* [x] ruff check . (all checks passed)
* [x] ruff format --check . (all files formatted)
* [x] python -m compileall . (no syntax errors)
* [x] New test file added with 4 comprehensive test cases

## Manual verification
* Crash handler now uses translated strings from i18n system
* Both English and Arabic translations work correctly
* Graceful fallback when QApplication or i18n is unavailable
* No regression in existing functionality

## Auto-merge decision
* Eligible for auto-merge: yes
* Reason: Low risk, comprehensive tests, completes existing i18n work, no breaking changes

## Out of scope
* Other hard-coded strings in the codebase (this fix specifically addresses the crash handler)
* Changes to crash handling logic itself
* Additional error message translations beyond the crash handler

## Next recommended slice
* Continue identifying and fixing any remaining hard-coded strings in the codebase
* Consider adding more comprehensive error handling and recovery mechanisms
* Review and improve other user-facing error messages for consistency