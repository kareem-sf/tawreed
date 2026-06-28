# Plan: Fix Remaining Hard-coded Strings in Workspace Page

## Problem
The workspace page has three hard-coded strings that should be routed through the i18n system:
- "Loaded: {name}" (line 287)
- "Saved: {output_path}" (line 435)
- "Error: {error_msg}" (line 472)

## User Impact
These strings are visible in the UI and should be translatable for Arabic users. Currently they appear in English only.

## Target Behavior
All UI strings should use the i18n system so they can be translated to Arabic when the user selects Arabic language.

## Files to Touch
- `core/i18n.py` - Add missing translation keys
- `gui/pages/workspace_page.py` - Update to use i18n for these strings
- `tests/` - Add regression test

## Risk Level
Low risk - this is a UI string change only, no logic changes.

## Acceptance Criteria
1. New translation keys added to both English and Arabic dictionaries
2. Workspace page updated to use i18n.tr() for these strings
3. Tests pass
4. Manual verification shows Arabic translation works

## Test Plan
- Run existing tests: `pytest -q`
- Add specific test for these strings
- Manual verification by switching language in Settings

## Rollback Plan
Simple revert of the two files if any issues arise.

## Scope Control
This change stays within Tawreed's BOQ-to-work-package mission by improving i18n completeness for better Arabic user experience.