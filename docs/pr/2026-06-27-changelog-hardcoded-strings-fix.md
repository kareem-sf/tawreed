# CHANGELOG and Hard-coded Strings Fix

## Summary
This PR fixes two issues in Tawreed:

1. **CHANGELOG Cleanup**: Removed duplicate entries from the [Unreleased] section that were already included in the [0.0.5] release section
2. **Hard-coded Strings**: Fixed remaining hard-coded "AI BOQ Processing" string in `main_window.py` to use the i18n system

## User value
- Cleaner, more accurate CHANGELOG that doesn't show the same fixes twice
- Complete i18n coverage - the app title now properly translates to Arabic ("توريد") when the user selects Arabic language
- Improved internationalization consistency

## Scope control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves documentation accuracy and completes the internationalization work, both of which enhance the user experience for the core BOQ processing workflow.

## What changed

### Core fixes:
- `CHANGELOG.md`: Removed duplicate "Settings Save" and "Reset Function" entries from [Unreleased] section
- `gui/main_window.py`: Changed hard-coded window title from `"AI BOQ Processing"` to use `self._i18n.tr('app_title')`

### Tests added:
- `tests/test_hardcoded_strings_fix.py`: Comprehensive tests for the hard-coded strings fix including:
  - Test that MainWindow title uses i18n instead of hard-coded string
  - Test that Arabic translation works correctly
  - Test that the hard-coded string no longer exists in the source code

## Risk assessment
- **Risk level**: Low
- **Possible failure**: None - these are documentation and i18n completeness fixes with comprehensive test coverage
- **Mitigation**: N/A
- **Rollback**: Revert the commit if needed

## Dependency decision
- **New dependency**: no

## Internal team review
- **Product**: ✅ Documentation and i18n improvements enhance user experience within BOQ-to-work-package scope
- **UX**: ✅ No UI changes, improves i18n consistency
- **Architecture**: ✅ No architectural changes
- **Engineering**: ✅ Clean, minimal changes with good test coverage
- **QA**: ✅ Comprehensive tests added
- **Security**: ✅ No security implications
- **DevOps**: ✅ No release process changes
- **Docs**: ✅ Clear documentation of changes

## Tests
- [x] `pytest -q` (145 passed, 3 skipped)
- [x] `ruff check .` (All checks passed)
- [x] `ruff format --check .` (All files formatted)
- [x] Manual verification of CHANGELOG cleanup
- [x] Manual verification of i18n title translation

## Manual verification
- Verified that CHANGELOG no longer has duplicate entries
- Verified that MainWindow title translates correctly to Arabic when language is set to Arabic
- Verified that MainWindow title shows English when language is set to English
- Verified that no hard-coded "AI BOQ Processing" string remains in main_window.py

## Auto-merge decision
- **Eligible for auto-merge**: yes
- **Reason**: Low-risk documentation and i18n completeness fixes with comprehensive test coverage, no breaking changes

## Out of scope
- No other changes needed for this fix

## Next recommended slice
- Continue with other priority items from the endless improvement loop
- Consider adding more comprehensive error handling for edge cases
- Review and improve test coverage for other critical paths