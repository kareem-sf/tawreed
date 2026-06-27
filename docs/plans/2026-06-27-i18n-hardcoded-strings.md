# Plan: Route Hard-Coded Strings Through i18n

## Problem
The workspace page contains several hard-coded English strings that should be routed through the i18n system for proper Arabic/English bilingual support.

## User Impact
- Arabic-speaking users see English strings in the workspace
- Inconsistent i18n coverage across the application
- Missed opportunity for full bilingual support

## Target Behavior
All visible UI strings in the workspace page should use the i18n system:
- Use `i18n.tr("key")` for all user-facing text
- Add missing translation keys to `core/i18n.py`
- Ensure Arabic translations are provided

## Files Likely Touched
- `gui/pages/workspace_page.py` - Route strings through i18n
- `core/i18n.py` - Add missing translation keys

## Risk Level
**Low risk** - This is a UI string refactoring that doesn't change behavior or data flow.

## Acceptance Criteria
- All hard-coded English strings in workspace page use i18n
- Arabic translations are complete
- Tests pass
- UI displays correctly in both languages

## Test Plan
- Run existing tests: `pytest -q`
- Manual verification: Launch app, switch between English/Arabic, verify all workspace strings translate
- Check ruff formatting

## Rollback Plan
Simple git revert - no database migrations or breaking changes.

## Scope Control Note
This PR stays within Tawreed's BOQ-to-work-package mission by improving bilingual UI support for quantity surveyors who work in Arabic and English.

## Implementation Steps
1. Add missing translation keys to `core/i18n.py`
2. Update `gui/pages/workspace_page.py` to use `i18n.tr()` for all user-facing strings
3. Run tests
4. Manual verification
