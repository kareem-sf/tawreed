# CHANGELOG Cleanup and i18n Improvements

## Problem
1. CHANGELOG has an empty "[Unreleased]" section that should be removed
2. Some hard-coded strings remain that should be routed through i18n
3. model/model_id parameter confusion needs better documentation

## User Impact
- Clean CHANGELOG makes it easier to understand release history
- Complete i18n ensures consistent Arabic/English experience
- Clear parameter documentation prevents developer confusion

## Target Behavior
- Remove empty Unreleased section from CHANGELOG
- Route all user-facing strings through i18n system
- Add regression tests for model/model_id parameter handling

## Files Likely Touched
- CHANGELOG.md
- gui/widgets/toast.py
- core/i18n.py (new translation keys)
- tests/ (new tests for model_id handling)

## Risk Level
Low - documentation and i18n improvements only, no functional changes

## Acceptance Criteria
- CHANGELOG has no empty Unreleased section
- All toast messages use i18n
- Tests pass for model/model_id parameter handling
- No regression in existing functionality

## Test Plan
- Run existing test suite
- Add specific tests for model_id parameter handling
- Verify i18n coverage

## Rollback Plan
Simple revert if any issues arise - no database migrations or breaking changes

## Scope Control
This PR stays within Tawreed's BOQ-to-work-package mission because it improves documentation clarity and i18n consistency, which directly benefits users processing BOQ files.
