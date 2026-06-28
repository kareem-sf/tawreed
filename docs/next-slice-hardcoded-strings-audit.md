# Next Recommended Slice: Final Hard-coded Strings Cleanup

## Problem
There are still a few remaining hard-coded English strings in the main window and workspace page that bypass the i18n system.

## User Impact
- Arabic-speaking users still see some English strings in the UI
- Incomplete bilingual support
- Breaks the "complete i18n support" claim

## Target Behavior
All visible UI strings should use the i18n translation system.

## Investigation Plan
1. Add translation keys to `core/i18n.py`:
   - `app_name_label`: "Tawreed"
   - `app_tagline`: "AI BOQ work packages"
   - `recent_files_label`: "Recent Files:"
   - `no_file_selected`: "No file selected" (already exists, but check usage)
   - `process_button_prefix`: "▶  " (the play icon prefix)

2. Update code:
   - `gui/main_window.py`: Route app name and tagline through i18n
   - `gui/pages/workspace_page.py`: Route recent files label and process button prefix through i18n

3. For each found hard-coded string:
   - Add translation key to `core/i18n.py`
   - Update code to use `self._i18n.tr("key")`
   - Add Arabic translation
   - Add regression test if appropriate

## Risk Level
Low - UI text only, no logic changes.

## Priority
High - This completes the i18n work and improves accessibility.

## Files to Touch
- `core/i18n.py` - Add missing translation keys
- `gui/main_window.py` - Route app name and tagline through i18n
- `gui/pages/workspace_page.py` - Route remaining hard-coded strings through i18n
- `tests/test_final_i18n_cleanup.py` - Add regression tests
