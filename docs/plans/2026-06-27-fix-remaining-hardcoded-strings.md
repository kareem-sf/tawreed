# Fix Remaining Hard-coded Strings in Workspace Page

## Problem
The workspace page still contains several hard-coded English strings that bypass the i18n system:

1. Line 83: `"Select BOQ Excel File"` in file dialog title
2. Line 226: `"Live Console"` in console card title  
3. Line 296: `"Select BOQ Excel File"` in file dialog title (duplicate)

## User Impact
- Arabic users see mixed English/Arabic UI
- Breaks complete bilingual support
- Inconsistent with other pages that use i18n properly

## Target Behavior
All visible strings should use the i18n system so they can be translated to Arabic and support RTL layout.

## Files to Touch
- `core/i18n.py`: Add missing translation keys
- `gui/pages/workspace_page.py`: Replace hard-coded strings with i18n calls
- `tests/test_workspace_i18n.py`: Add regression tests

## Risk Level
Low - this is a UI string cleanup with no business logic changes.

## Acceptance Criteria
- [ ] All hard-coded strings in workspace_page.py are replaced with i18n.tr() calls
- [ ] New translation keys added to both English and Arabic dictionaries
- [ ] Tests pass showing no hard-coded strings remain
- [ ] Manual verification in both English and Arabic modes

## Test Plan
1. Run existing tests to ensure no regression
2. Add new tests for the specific strings being fixed
3. Verify UI shows translated strings in both languages

## Rollback Plan
Simple revert of the commit since this is isolated to UI strings.