# Plan: Route Excel Module Hard-coded Strings Through i18n

## Problem
The `core/excel.py` module contains many hard-coded error messages and user-facing strings that are not routed through the i18n translation system. This breaks the bilingual experience for Arabic users and violates the project's i18n completeness goal.

## User Impact
- Arabic users see English error messages when Excel operations fail
- Inconsistent user experience - some errors are translated, others are not
- Reduces professionalism and accessibility of the application

## Target Behavior
All user-facing strings in the Excel module should:
1. Use the i18n system with proper translation keys
2. Support both English and Arabic translations
3. Maintain the same level of detail and helpfulness as current messages
4. Preserve the existing error handling logic

## Files Likely Touched
- `core/excel.py` - Main implementation
- `gui/i18n.py` - Add new translation keys
- `tests/test_excel.py` - Add tests for new i18n behavior
- `tests/test_i18n.py` - Add tests for new translation keys

## Risk Level
**Low risk** - This is a string replacement operation that doesn't change the core logic or behavior. All existing error conditions and handling remain the same, just the messages become translatable.

## Possible Failure Mode
- Missing translation keys could cause KeyError exceptions
- Incorrect string formatting could break error messages

## Mitigation
- Add all new translation keys before changing the code
- Use the same fallback pattern as existing i18n code: `i18n.tr(key) if i18n else "fallback English text"`
- Add comprehensive tests to verify all error paths work with and without i18n context

## Rollback Plan
If issues arise, revert the commit. The changes are isolated to string handling and don't affect core functionality.

## Acceptance Criteria
1. All hard-coded error messages in `core/excel.py` are replaced with i18n calls
2. New translation keys are added for English and Arabic
3. Tests verify i18n behavior for all error paths
4. Existing functionality remains unchanged
5. All existing tests still pass

## Test Plan
1. Run existing test suite to ensure no regressions
2. Add specific tests for new i18n error messages
3. Test with both English and Arabic locales
4. Verify error messages appear correctly in UI

## Scope Control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves the user experience for Arabic-speaking quantity surveyors by ensuring consistent bilingual error messaging during Excel processing, which is core to the workflow.
