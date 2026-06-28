# Model ID Consistency Fix

## Problem
There's inconsistency between `model` and `model_id` parameter names across the codebase:
- `gui/worker.py::check_connection()` uses `model_id` parameter
- `core/ai.py::test_connection()` uses `model` parameter
- `gui/worker.py::run_analysis()` uses `model_id` parameter
- `core/ai.py::run_analysis()` uses `model` parameter

This creates confusion and potential for bugs when the parameters are passed between modules.

## User Impact
- No direct user-facing impact, but this inconsistency could lead to bugs in future development
- Makes the codebase harder to maintain and understand
- Could cause issues if new developers work on the codebase

## Target Behavior
- Standardize on using `model` parameter name throughout the codebase
- Maintain backward compatibility by keeping `model_id` as an alias where needed
- Add tests to ensure the consistency is maintained

## Files Likely Touched
- `gui/worker.py` - Update function signatures and parameter names
- `tests/` - Add tests to verify the consistency

## Risk Level
- **Low risk**: This is primarily a code consistency issue with no direct user impact
- The changes will be backward compatible
- All existing tests should continue to pass

## Acceptance Criteria
1. All function signatures use consistent parameter naming (`model`)
2. Backward compatibility is maintained
3. All existing tests pass
4. New tests are added to prevent regression

## Test Plan
1. Run existing test suite to ensure no regressions
2. Add specific tests for model parameter consistency
3. Verify all tests pass

## Rollback Plan
If any issues arise:
1. Revert the parameter name changes
2. Keep the backward compatibility aliases
3. Document the inconsistency for future resolution

## Scope-Control Note
This PR will only address the parameter naming consistency issue. It will not:
- Change any business logic
- Modify any user-facing functionality
- Add new features
- Change the API or external interfaces

The scope is limited to internal code consistency improvements only.
