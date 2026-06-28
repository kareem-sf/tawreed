"""Test model parameter consistency across the codebase."""

import inspect

from core.ai import analyze_boq_stream
from gui.worker import check_connection, run_analysis


def test_test_connection_has_model_parameter():
    """Test that test_connection uses 'model_id' parameter."""
    from core.ai import test_connection

    sig = inspect.signature(test_connection)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"test_connection should have 'model_id' parameter, got: {params}"
    assert "model" not in params, (
        f"test_connection should not have 'model' parameter, got: {params}"
    )


def test_analyze_boq_stream_has_model_id_parameter():
    """Test that analyze_boq_stream uses 'model_id' parameter."""
    sig = inspect.signature(analyze_boq_stream)
    params = list(sig.parameters.keys())
    assert "model_id" in params, (
        f"analyze_boq_stream should have 'model_id' parameter, got: {params}"
    )
    assert "model" not in params, (
        f"analyze_boq_stream should not have 'model' parameter, got: {params}"
    )


def test_check_connection_has_model_id_parameter():
    """Test that check_connection uses 'model_id' parameter."""
    sig = inspect.signature(check_connection)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"check_connection should have 'model_id' parameter, got: {params}"
    assert "model" not in params, (
        f"check_connection should not have 'model' parameter, got: {params}"
    )


def test_run_analysis_has_model_id_parameter():
    """Test that run_analysis uses 'model_id' parameter."""
    sig = inspect.signature(run_analysis)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"run_analysis should have 'model_id' parameter, got: {params}"
    assert "model" not in params, f"run_analysis should not have 'model' parameter, got: {params}"


def test_parameter_consistency_across_modules():
    """Test that parameter naming is consistent where it should be."""
    # analyze_boq_stream and run_analysis should both use model_id
    # since run_analysis calls analyze_boq_stream
    analyze_sig = inspect.signature(analyze_boq_stream)
    run_sig = inspect.signature(run_analysis)

    analyze_params = list(analyze_sig.parameters.keys())
    run_params = list(run_sig.parameters.keys())

    assert "model_id" in analyze_params, "analyze_boq_stream should use model_id"
    assert "model_id" in run_params, "run_analysis should use model_id"

    # check_connection calls test_connection, but they use different parameter names
    # This is the inconsistency we want to fix
    from core.ai import test_connection

    check_sig = inspect.signature(check_connection)
    test_sig = inspect.signature(test_connection)

    check_params = list(check_sig.parameters.keys())
    test_params = list(test_sig.parameters.keys())

    # Verify the fix: both should now use model_id
    assert "model_id" in check_params, "check_connection should use model_id"
    assert "model_id" in test_params, "test_connection should use model_id"
    assert "model" not in check_params, "check_connection should not use model"
    assert "model" not in test_params, "test_connection should not use model"
    print("✓ Parameter consistency verified: both use 'model_id'")
