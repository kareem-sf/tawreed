# Excel Merged Header Support

## Problem
Real-world construction BOQ spreadsheets often use merged header cells (e.g., "Item Description" spanning columns B-C, "Unit" in D, etc.). The current `detect_columns()` function only looks at individual cell values and misses merged headers, causing column misalignment.

## User Impact
- BOQ files with merged headers fail to parse correctly
- Item descriptions, quantities, or rates end up in wrong columns
- User gets incomplete or incorrect work-package output

## Target Behavior
- Detect merged header cells and use the merged cell's value for column identification
- Handle both horizontal and vertical merges
- Maintain backward compatibility with non-merged headers
- Add comprehensive tests for merged header scenarios

## Files Likely Touched
- `core/excel.py` - modify `detect_columns()` and `parse_excel()`
- `tests/test_excel_parsing.py` - add merged header tests

## Risk Level
**Medium risk** - Changes to core Excel parsing logic, but focused on header detection only

## Possible Failure Modes
- Merged cell detection fails on some Excel versions
- Performance degradation with complex merged regions
- False positives in merge detection

## Mitigation
- Add extensive unit tests with real merged header scenarios
- Keep fallback to original behavior if merge detection fails
- Add logging for debug visibility
- Run full test suite before and after changes

## Rollback Plan
- Revert to previous commit if tests fail
- The change is isolated to header detection, so rollback is clean

## Acceptance Criteria
1. ✅ Parse Excel files with merged headers correctly
2. ✅ Maintain 100% backward compatibility with existing files
3. ✅ All existing tests still pass
4. ✅ New tests cover merged header scenarios
5. ✅ Performance not degraded (>50% slower is unacceptable)

## Test Plan
- Add unit tests for horizontal merged headers
- Add unit tests for vertical merged headers  
- Add unit tests for mixed merged/non-merged headers
- Run full test suite (166 tests + new ones)
- Manual verification with sample merged-header BOQ

## Scope Control
This improvement stays within Tawreed's BOQ-to-work-package mission by:
- Only affecting Excel parsing accuracy (core functionality)
- Not adding new features or changing output format
- Not modifying AI processing or UI
- Maintaining the same deliverable structure