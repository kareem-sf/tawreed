# Complete i18n Coverage

## Problem
The i18n system is comprehensive but there are a few remaining hard-coded strings that need to be routed through the translation system:

1. **Settings Page**: `"Testing connection…"` status message (line 474)
2. **Excel Module**: User-facing error messages that should be translated

## User Impact
- Arabic users will see English error messages in some edge cases
- Inconsistent bilingual experience
- Some status messages don't respect language preference

## Target Behavior
All user-facing strings should use the i18n system:
- `self.status_label.setText("Testing connection…")` → `self.status_label.setText(self._i18n.tr("testing_connection_status"))`
- Excel error messages should use translation keys

## Files Likely Touched
- `gui/pages/settings_page.py` (line 474)
- `core/i18n.py` (add new translation keys)
- `core/excel.py` (route error messages through i18n)

## Risk Level
**Low risk**:
- Changes are isolated to string routing
- Fallback logic already exists in worker.py
- All changes preserve existing behavior

## Acceptance Criteria
1. No hard-coded user-facing strings remain
2. All error messages use i18n system
3. All tests pass
4. Manual verification shows consistent bilingual UI

## Test Plan
1. Run existing test suite
2. Test Arabic language mode
3. Test error conditions (file not found, invalid Excel)
4. Verify status messages appear in correct language

## Rollback Plan
Simple revert - all changes are isolated to translation routing and don't affect core logic

## Scope Control Note
This PR stays within Tawreed's BOQ-to-work-package mission by improving UI consistency and accessibility for Arabic-speaking users, which directly supports the core workflow.