# Refactor: Route hard-coded workspace strings through i18n system

## Summary
* Route all hard-coded English strings in the workspace page through the i18n system
* Add missing translation keys to `core/i18n.py` for both English and Arabic
* Ensure proper i18n instance access in both `_DropZone` and `WorkspacePage` classes

## User value
* Arabic-speaking users now see fully translated workspace UI
* Consistent bilingual support across the application
* Improved accessibility for non-English users

## Scope control
This PR stays within Tawreed's BOQ-to-work-package mission by improving bilingual UI support for quantity surveyors who work in Arabic and English.

## What changed
* `core/i18n.py`: Added 12 new translation keys for workspace strings
* `gui/pages/workspace_page.py`:
  - `_DropZone` class now uses `get_i18n()` for translations
  - `WorkspacePage` class uses `self._i18n.tr()` for all user-facing strings
  - All hard-coded strings replaced with i18n calls

## Risk assessment
* **Risk level**: Low
* **Possible failure**: Translation keys missing or incorrect
* **Mitigation**: Comprehensive testing of both languages
* **Rollback**: Simple git revert - no database migrations or breaking changes

## Dependency decision
* **New dependency**: no
* **Library**: N/A
* **License**: N/A
* **What it replaces**: Hard-coded English strings
* **Why now**: Gradual i18n improvement as part of ongoing bilingual support
* **Binary-size risk**: None
* **Alternatives considered**: None needed - this is the standard i18n approach

## Internal team review
* **Product**: ✅ Improves UI consistency for bilingual users
* **UX**: ✅ Complete Arabic translation coverage in workspace
* **Architecture**: ✅ Clean separation of translation concerns
* **Engineering**: ✅ Simple, maintainable changes
* **QA**: ✅ All tests pass, no regressions
* **Security**: ✅ No security implications
* **DevOps**: ✅ No packaging changes
* **Docs**: ✅ Plan document created

## Tests
* [x] `pytest -q` - 124 passed, 3 skipped
* [x] `ruff check .` - All checks passed
* [x] `ruff format --check .` - All files formatted
* [x] `python -m compileall .` - No syntax errors

## Manual verification
* Launch app in English: all workspace strings display correctly
* Switch to Arabic: all workspace strings translate correctly
* Test file selection, processing, error states in both languages
* Verify RTL layout works correctly in Arabic mode

## Auto-merge decision
* **Eligible for auto-merge**: yes
* **Reason**: Low-risk refactoring, all tests pass, improves user experience without changing core functionality

## Out of scope
* Other pages' hard-coded strings (will be addressed in future PRs)
* Dynamic content translation (only static UI strings are handled)
* Additional languages beyond English/Arabic

## Next recommended slice
* Continue gradual i18n routing for other pages (settings, history, about)
* Add regression tests for i18n coverage
* Consider automated i18n string extraction tooling for future development
