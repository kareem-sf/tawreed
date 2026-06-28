"""Test Excel i18n functionality end-to-end."""

from __future__ import annotations

import os
import tempfile
import pytest
from unittest.mock import MagicMock

from openpyxl import Workbook
from core.excel import parse_excel, write_excel, _should_warn_about_file_size
from core.i18n import get_i18n


def create_test_workbook():
    """Create a simple test workbook for testing."""
    wb = Workbook()
    ws = wb.active
    
    # Add headers
    ws["A1"] = "Nr."
    ws["B1"] = "Item Description"
    ws["C1"] = "Unit"
    ws["D1"] = "Qty"
    ws["E1"] = "Rate"
    ws["F1"] = "Amount"
    
    # Add some data rows
    ws["A2"] = "1"
    ws["B2"] = "Concrete work"
    ws["C2"] = "m3"
    ws["D2"] = 100
    ws["E2"] = 50
    ws["F2"] = "=D2*E2"
    
    return wb


def test_excel_large_file_warnings_with_i18n():
    """Test that large file warnings use i18n translations."""
    i18n = get_i18n()
    
    # Test English warnings
    i18n.set_language("en")
    
    # Test very large file warning (100MB+)
    warning = _should_warn_about_file_size(150 * 1024 * 1024, i18n)  # 150 MB
    assert warning is not None
    assert "Very large file detected" in warning
    assert "150.0 MB" in warning
    assert "Processing will continue but may take significant time" in warning
    
    # Test large file warning (50MB+)
    warning = _should_warn_about_file_size(75 * 1024 * 1024, i18n)  # 75 MB
    assert warning is not None
    assert "Large file detected" in warning
    assert "75.0 MB" in warning
    assert "Estimated processing time" in warning
    
    # Test no warning for small file
    warning = _should_warn_about_file_size(1 * 1024 * 1024, i18n)  # 1 MB
    assert warning is None
    
    # Test Arabic warnings
    i18n.set_language("ar")
    
    # Test very large file warning in Arabic
    warning = _should_warn_about_file_size(150 * 1024 * 1024, i18n)  # 150 MB
    assert warning is not None
    assert "تم اكتشاف ملف كبير جدًا" in warning
    assert "150.0 ميجابايت" in warning
    assert "ستستمر المعالجة ولكن قد تستغرق وقتًا كبيرًا" in warning
    
    # Test large file warning in Arabic
    warning = _should_warn_about_file_size(75 * 1024 * 1024, i18n)  # 75 MB
    assert warning is not None
    assert "تم اكتشاف ملف كبير" in warning
    assert "75.0 ميجابايت" in warning
    assert "الوقت المقدر للمعالجة" in warning


def test_excel_large_file_warnings_without_i18n():
    """Test that large file warnings work without i18n context (fallback to English)."""
    # Test very large file warning without i18n
    warning = _should_warn_about_file_size(150 * 1024 * 1024, None)  # 150 MB
    assert warning is not None
    assert "Very large file detected (150.0 MB)" in warning
    assert "Estimated processing time" in warning
    assert "Processing will continue but may take significant time" in warning
    
    # Test large file warning without i18n
    warning = _should_warn_about_file_size(75 * 1024 * 1024, None)  # 75 MB
    assert warning is not None
    assert "Large file detected (75.0 MB)" in warning
    assert "Estimated processing time" in warning


def test_excel_progress_messages_with_i18n():
    """Test that Excel progress messages use i18n translations."""
    i18n = get_i18n()
    
    # Create a test workbook
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = tmp.name
        wb = create_test_workbook()
        wb.save(tmp_path)
    
    try:
        # Mock progress callback to capture messages
        progress_messages = []
        def mock_progress(percentage, message, metadata=None):
            progress_messages.append(message)
        
        # Test English progress messages
        i18n.set_language("en")
        result = parse_excel(tmp_path, i18n=i18n, progress_callback=mock_progress)
        
        # Check that we got progress messages
        assert len(progress_messages) > 0
        
        # Check for expected English messages
        english_messages = [msg for msg in progress_messages if isinstance(msg, str)]
        assert any("Starting chunked processing" in msg for msg in english_messages) or any("Completed processing" in msg for msg in english_messages)
        
        # Test Arabic progress messages
        progress_messages.clear()
        i18n.set_language("ar")
        result = parse_excel(tmp_path, i18n=i18n, progress_callback=mock_progress)
        
        # Check that we got progress messages in Arabic
        assert len(progress_messages) > 0
        
        # Check for expected Arabic messages
        arabic_messages = [msg for msg in progress_messages if isinstance(msg, str)]
        assert any("بدء المعالجة المجزأة" in msg for msg in arabic_messages) or any("تمت معالجة ورقة" in msg for msg in arabic_messages)
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def test_excel_progress_messages_without_i18n():
    """Test that Excel progress messages work without i18n context (fallback to English)."""
    # Create a test workbook
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = tmp.name
        wb = create_test_workbook()
        wb.save(tmp_path)
    
    try:
        # Mock progress callback to capture messages
        progress_messages = []
        def mock_progress(percentage, message, metadata=None):
            progress_messages.append(message)
        
        result = parse_excel(tmp_path, i18n=None, progress_callback=mock_progress)
        
        # Check that we got progress messages
        assert len(progress_messages) > 0
        
        # Check for expected English fallback messages
        english_messages = [msg for msg in progress_messages if isinstance(msg, str)]
        assert any("Starting chunked processing" in msg for msg in english_messages) or any("Completed processing" in msg for msg in english_messages)
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def test_excel_progress_messages_with_i18n(capfd):
    """Test that Excel progress messages use i18n translations."""
    i18n = get_i18n()
    
    # Create a test workbook
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = tmp.name
        wb = create_test_workbook()
        wb.save(tmp_path)
    
    try:
        # Mock progress callback to capture messages
        progress_messages = []
        def mock_progress(percentage, message, metadata=None):
            progress_messages.append(message)
        
        # Test English progress messages
        i18n.set_language("en")
        result = parse_excel(tmp_path, i18n=i18n, progress_callback=mock_progress)
        
        # Check that we got progress messages
        assert len(progress_messages) > 0
        
        # Check for expected English messages
        english_messages = [msg for msg in progress_messages if isinstance(msg, str)]
        assert any("Starting chunked processing" in msg for msg in english_messages) or any("Completed processing" in msg for msg in english_messages)
        
        # Test Arabic progress messages
        progress_messages.clear()
        i18n.set_language("ar")
        result = parse_excel(tmp_path, i18n=i18n, progress_callback=mock_progress)
        
        # Check that we got progress messages in Arabic
        assert len(progress_messages) > 0
        
        # Check for expected Arabic messages
        arabic_messages = [msg for msg in progress_messages if isinstance(msg, str)]
        assert any("بدء المعالجة المجزأة" in msg for msg in arabic_messages) or any("تمت معالجة ورقة" in msg for msg in arabic_messages)
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def test_excel_progress_messages_without_i18n(capfd):
    """Test that Excel progress messages work without i18n context (fallback to English)."""
    # Create a test workbook
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = tmp.name
        wb = create_test_workbook()
        wb.save(tmp_path)
    
    try:
        # Mock progress callback to capture messages
        progress_messages = []
        def mock_progress(percentage, message, metadata=None):
            progress_messages.append(message)
        
        result = parse_excel(tmp_path, i18n=None, progress_callback=mock_progress)
        
        # Check that we got progress messages
        assert len(progress_messages) > 0
        
        # Check for expected English fallback messages
        english_messages = [msg for msg in progress_messages if isinstance(msg, str)]
        assert any("Starting chunked processing" in msg for msg in english_messages) or any("Completed processing" in msg for msg in english_messages)
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)