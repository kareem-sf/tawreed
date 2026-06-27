# Plan: Fix Hard-coded Settings Form Labels

## Problem
The Settings page has hard-coded form labels "Base URL" and "API Key" that bypass the i18n system, breaking complete bilingual support.

## User Impact
- Arabic users see English labels mixed with Arabic UI
- Inconsistent translation coverage
- Breaks the "complete i18n support" claim from v0.0.4

## Target Behavior
All form labels should use `self._i18n.tr("key")` for translation, just like other UI elements.

## Files to Touch
- `gui/pages/settings_page.py` - Replace hard-coded form labels with i18n calls
- `core/i18n.py` - Add missing translation keys

## Risk Level
Low risk:
- Only affects UI text display
- No logic changes
- Existing tests cover i18n functionality
- Can be verified visually

## Acceptance Criteria
1. "Base URL" label uses i18n translation
2. "API Key" label uses i18n translation  
3. Arabic translation exists for both keys
4. All existing tests still pass
5. Manual verification shows Arabic UI has translated labels

## Test Plan
- Run existing i18n tests
- Run full test suite
- Manual verification with Arabic language setting

## Rollback Plan
Simple revert - the change is isolated to two lines in settings_page.py and two translation entries.

## Scope Control
This fix stays within Tawreed's BOQ-to-work-package mission by improving UI consistency and accessibility for Arabic-speaking users, which directly supports the core workflow.
