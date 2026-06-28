# Excel Header Detection Enhancement

## Problem

The current Excel header detection in `core/excel.py` is robust but could be enhanced to handle additional edge cases found in real-world construction BOQs:

1. **Mixed case headers**: Some BOQs use "Item No." vs "ITEM NO." vs "item no"
2. **Additional header variations**: Some BOQs use "Work Item" instead of "Item" or "Description"
3. **Header merging patterns**: Some BOQs merge headers across multiple rows
4. **Non-standard column orders**: Some BOQs place Quantity before Description

## User Impact

- Improves success rate for parsing real-world construction BOQs
- Reduces manual intervention needed for header mapping
- Provides better error messages when headers can't be detected
- Maintains backward compatibility with existing BOQ formats

## Target Behavior

1. **Enhanced keyword matching**: Support more variations of common header terms
2. **Improved scoring algorithm**: Better handle ties and ambiguous column assignments
3. **Better error messages**: Provide specific guidance when headers can't be detected
4. **Header pattern validation**: Detect and warn about unusual header patterns

## Files Likely Touched

- `core/excel.py` - Main header detection logic
- `core/i18n.py` - New error messages (if needed)
- `tests/test_excel_parsing.py` - Additional test cases

## Risk Level

**Low risk** - This is an enhancement to existing functionality, not a breaking change. The improvements will be additive and maintain backward compatibility.

## Acceptance Criteria

1. Header detection successfully identifies 95%+ of common BOQ header patterns
2. All existing tests continue to pass
3. New test cases cover the enhanced patterns
4. Error messages are clear and actionable
5. Performance is not degraded

## Test Plan

1. Add test cases for new header patterns
2. Verify backward compatibility with existing patterns
3. Test performance with large files
4. Test i18n support for any new error messages

## Rollback Plan

If issues arise, the changes can be easily reverted since they are isolated to the header detection logic and don't affect the core parsing pipeline.

## Scope Control

This enhancement stays within Tawreed's BOQ-to-work-package mission by improving the reliability of BOQ parsing, which is core to the application's value proposition.