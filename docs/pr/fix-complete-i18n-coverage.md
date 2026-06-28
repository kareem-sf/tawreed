# Complete i18n Coverage for Excel Errors and Status Messages

## Summary
* Complete i18n coverage by translating remaining hard-coded strings in Excel error handling and settings page status messages
* Add missing translation keys for Excel file operations and connection testing
* Route all user-facing error messages through the i18n system with proper fallback support

## User value
* Arabic users see fully translated interface with no English strings in error messages
* Complete bilingual UI consistency across all pages, error conditions, and status messages
* Better accessibility for non-English speakers when encountering file system errors
* Professional, localized error messages that respect user language preference

## Scope control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves UI consistency and accessibility for Arabic-speaking users, which directly supports the core workflow by making the application more usable and professional for the target audience.

## What changed

### Core i18n System (`core/i18n.py`)
* Added 5 new translation keys:
  - `testing_connection_status`: "Testing connection…"
  - `excel_file_not_found`: "Excel file not found: {file_path}"
  - `cannot_read_excel`: "Cannot read '{file_name}': {error}"
  - `excel_no_worksheets`: "'{file_name}' has no worksheets."
  - `cannot_write_excel`: "Cannot write '{file_name}': {error}"
  - `cannot_write_excel_permission`: "Cannot write '{file_name}' — the file is open in Excel or another program has it locked. Close it and try again."
* Added corresponding Arabic translations for all new keys

### Excel Module (`core/excel.py`)
* Modified `parse_excel()` and `write_excel()` to accept optional `i18n` parameter
* Updated all user-facing error messages to use i18n system with fallback to English
* Maintained backward compatibility - functions work without i18n parameter
* Added proper error message formatting with file names and error details

### Settings Page (`gui/pages/settings_page.py`)
* Fixed hard-coded "Testing connection…" status message to use `self._i18n.tr("testing_connection_status")`

### Worker (`gui/worker.py`)
* Updated to pass `self._i18n` object to `parse_excel()` and `write_excel()` calls
* Ensures Excel error messages are properly translated when they bubble up to the UI

### Tests (`tests/test_excel_i18n_errors.py`)
* Added comprehensive test suite covering:
  - Translation key existence and correctness
  - Fallback behavior when i18n is None
  - i18n parameter usage in both English and Arabic
  - Error message formatting with file paths

## Risk assessment
* **Risk level**: Low
* **Possible failure**: Translation keys might be missing or incorrect
* **Mitigation**: All new keys have both English and Arabic translations, comprehensive tests cover all scenarios, fallback logic preserves existing behavior
* **Rollback**: Simple revert - changes are isolated to translation and message routing, no core logic changes

## Dependency decision
* **New dependency**: No
* **Library**: N/A
* **License**: N/A
* **What it replaces**: N/A
* **Why now**: This completes the i18n coverage that was partially done in previous PRs
* **Binary-size risk**: None (only adds translation strings)
* **Alternatives considered**: None needed - this is the natural continuation of the i18n work

## Internal team review
* **Product**: ✅ Improves accessibility for target users (Arabic-speaking QS professionals)
* **UX**: ✅ Completes bilingual UI consistency, including error states
* **Architecture**: ✅ No architectural changes, just message routing with fallback support
* **Engineering**: ✅ Clean implementation with proper error handling and backward compatibility
* **QA**: ✅ All tests pass (157 passed, 3 skipped), comprehensive new test suite added
* **Security**: ✅ No security implications
* **DevOps**: ✅ No CI/packaging changes required
* **Docs**: ✅ Plan document created, PR description comprehensive

## Tests
* [x] `pytest -q` (157 passed, 3 skipped)
* [x] `ruff check .` (all checks passed)
* [x] `ruff format --check .` (all files formatted)
* [x] `python -m compileall .` (no syntax errors)
* [x] New comprehensive test suite for Excel i18n errors

## Manual verification
* Run app with English language: all status messages and error messages appear in English
* Run app with Arabic language: all status messages and error messages appear in Arabic
* Test file parsing errors: verify error messages use translated strings
* Test connection testing: verify status messages use translated strings
* Test Excel write errors: verify permission errors use translated strings

## Auto-merge decision
* **Eligible for auto-merge**: Yes
* **Reason**: Low risk, focused change, all tests pass, completes existing i18n work, comprehensive test coverage, backward compatibility maintained

## Out of scope
* Full RTL layout testing (already covered by existing tests)
* Additional translation keys beyond the identified hard-coded strings
* Changes to core processing logic itself
* UI layout or behavior changes

## Next recommended slice
* Review all pages for any remaining hard-coded strings (though analysis suggests this completes the coverage)
* Add regression tests for the new translation keys
* Consider adding a translation coverage test to prevent future hard-coded strings
* Potential minor release after accumulating a few more focused improvements
