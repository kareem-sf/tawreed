"""Test that the crash handler uses i18n for error messages."""

from unittest.mock import MagicMock, patch


def test_crash_handler_uses_i18n():
    """Test that the crash handler in main.py uses translated strings."""
    # Mock the QMessageBox.critical to capture the arguments
    with patch("PySide6.QtWidgets.QMessageBox.critical") as mock_critical:
        # Mock QApplication.instance to return a valid app
        with patch("PySide6.QtWidgets.QApplication.instance", return_value=MagicMock()):
            # Mock get_i18n to return a mock i18n instance
            with patch("core.i18n.get_i18n") as mock_get_i18n:
                mock_i18n = MagicMock()
                mock_i18n.tr.side_effect = lambda key: {
                    "unexpected_error_title": "Tawreed — unexpected error",
                    "unexpected_error_message": "An unhandled error occurred:\n\n{error}\n\nDetails have been saved to:\n{log_path}",
                }.get(key, key)
                mock_get_i18n.return_value = mock_i18n

                # Import and call the crash handler
                from main import _excepthook

                # Simulate an exception
                exc_type = ValueError
                exc_value = ValueError("test error")
                exc_tb = None

                _excepthook(exc_type, exc_value, exc_tb)

                # Verify QMessageBox.critical was called
                mock_critical.assert_called_once()

                # Get the call arguments
                call_args = mock_critical.call_args
                title = call_args[0][1]
                message = call_args[0][2]

                # Verify the title and message use translated strings
                assert title == "Tawreed — unexpected error"
                assert "An unhandled error occurred" in message
                assert "test error" in message
                assert "tawreed.log" in message


def test_crash_handler_arabic_translation():
    """Test that the crash handler shows Arabic messages when language is Arabic."""
    with patch("PySide6.QtWidgets.QMessageBox.critical") as mock_critical:
        with patch("PySide6.QtWidgets.QApplication.instance", return_value=MagicMock()):
            with patch("core.i18n.get_i18n") as mock_get_i18n:
                mock_i18n = MagicMock()
                mock_i18n.tr.side_effect = lambda key: {
                    "unexpected_error_title": "توريد — خطأ غير متوقع",
                    "unexpected_error_message": "حدث خطأ غير متوقع:\n\n{error}\n\nتم حفظ التفاصيل في:\n{log_path}",
                }.get(key, key)
                mock_get_i18n.return_value = mock_i18n

                from main import _excepthook

                exc_type = ValueError
                exc_value = ValueError("اختبار خطأ")
                exc_tb = None

                _excepthook(exc_type, exc_value, exc_tb)

                # Verify QMessageBox.critical was called with Arabic strings
                call_args = mock_critical.call_args
                title = call_args[0][1]
                message = call_args[0][2]

                assert title == "توريد — خطأ غير متوقع"
                assert "حدث خطأ غير متوقع" in message
                assert "اختبار خطأ" in message
                assert "tawreed.log" in message


def test_crash_handler_fallback_when_no_qapplication():
    """Test that crash handler gracefully handles missing QApplication."""
    with patch("PySide6.QtWidgets.QMessageBox.critical") as mock_critical:
        with patch("PySide6.QtWidgets.QApplication.instance", return_value=None):
            from main import _excepthook

            exc_type = ValueError
            exc_value = ValueError("test error")
            exc_tb = None

            # Should not raise an exception
            _excepthook(exc_type, exc_value, exc_tb)

            # QMessageBox.critical should not be called when no QApplication
            mock_critical.assert_not_called()


def test_crash_handler_fallback_when_i18n_fails():
    """Test that crash handler handles i18n import failures gracefully."""
    with patch("PySide6.QtWidgets.QMessageBox.critical") as mock_critical:
        with patch("PySide6.QtWidgets.QApplication.instance", return_value=MagicMock()):
            with patch("core.i18n.get_i18n", side_effect=ImportError("i18n failed")):
                from main import _excepthook

                exc_type = ValueError
                exc_value = ValueError("test error")
                exc_tb = None

                # Should not raise an exception - the outer try/except should catch it
                _excepthook(exc_type, exc_value, exc_tb)

                # QMessageBox.critical should not be called when i18n fails
                mock_critical.assert_not_called()
