"""Tests for enhanced Excel header detection."""

from core.excel import _score_column, _validate_header_pattern, detect_columns


def test_enhanced_header_detection():
    """Test that enhanced header detection recognizes additional header variations."""
    # Test new header variations
    test_cases = [
        ("Item No", {"no": 1}),
        ("ITEM NO.", {"no": 1}),
        ("item no.", {"no": 1}),
        ("Item #", {"no": 1}),
        ("Work Description", {"desc": 1}),
        (
            "Item Name",
            {"no": 1, "desc": 1},
        ),  # Matches both due to "Item" in no and description keywords
        ("Qty Required", {"qty": 1}),
        ("Qty Reqd", {"qty": 1}),
        ("Quantity Required", {"qty": 1}),
        ("الكمية المطلوبة", {"qty": 1}),
    ]

    for header_text, expected_scores in test_cases:
        scores = _score_column(header_text)
        assert scores == expected_scores, (
            f"Header '{header_text}' should score {expected_scores}, got {scores}"
        )


def test_header_pattern_validation():
    """Test header pattern validation function."""
    # Valid patterns should return None
    valid_patterns = [
        {"no": 0, "desc": 1},  # Minimum viable
        {"no": 0, "desc": 1, "unit": 2, "qty": 3, "rate": 4, "total": 5},  # Complete
        {"no": 0, "desc": 1, "qty": 2},  # Partial but valid
    ]

    for pattern in valid_patterns:
        result = _validate_header_pattern(pattern)
        assert result is None, f"Valid pattern {pattern} should return None, got {result}"

    # Invalid patterns should return error messages
    invalid_patterns = [
        ({}, "required columns"),
        ({"unit": 0}, "required columns"),
        ({"desc": 1}, "Item Number"),
        ({"no": 0}, "Description"),
    ]

    for pattern, expected_keyword in invalid_patterns:
        result = _validate_header_pattern(pattern)
        assert result is not None, f"Invalid pattern {pattern} should return an error message"
        assert expected_keyword in result, (
            f"Error message should contain '{expected_keyword}', got: {result}"
        )


def test_header_validation_integration():
    """Test that header validation integrates properly with detect_columns."""
    # This is more of a smoke test to ensure no exceptions are raised
    header_cells = ["Item No", "Description", "Unit", "Qty", "Rate", "Amount"]

    # Should work without issues
    result = detect_columns(header_cells)
    assert "no" in result
    assert "desc" in result

    # Test with problematic headers
    problematic_cells = ["Description", "Something Else"]  # Missing Item No
    result = detect_columns(problematic_cells)

    # Should still work but only detect description
    assert "desc" in result
    assert "no" not in result

    # Validation should catch this
    validation_error = _validate_header_pattern(result)
    assert validation_error is not None
    assert "Item Number" in validation_error
