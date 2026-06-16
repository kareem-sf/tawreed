"""Toast notification widget for Tawreed.

Provides non-blocking, auto-dismissing notifications that appear
in the bottom-right corner of the main window.
"""

from __future__ import annotations

from PySide6.QtCore import QPropertyAnimation, QEasingCurve, Qt, QTimer
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget


class Toast(QFrame):
    """A single toast notification."""

    def __init__(self, message: str, duration: int = 3000, parent: QWidget | None = None):
        super().__init__(parent)
        self.setObjectName("toast")
        self._message = message
        self._duration = duration
        self._setup_ui()
        self._setup_animations()

    def _setup_ui(self) -> None:
        """Set up the toast UI."""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(12)

        # Icon placeholder (can be extended to show different icons)
        self.icon_label = QLabel()
        self.icon_label.setFixedSize(20, 20)
        self.icon_label.setObjectName("toastIcon")

        # Message label
        self.message_label = QLabel(self._message)
        self.message_label.setObjectName("toastMessage")
        self.message_label.setWordWrap(True)

        layout.addWidget(self.icon_label)
        layout.addWidget(self.message_label, stretch=1)

        # Styling
        self.setFixedWidth(320)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.ToolTip)
        self.setAttribute(Qt.WA_TranslucentBackground)

    def _setup_animations(self) -> None:
        """Set up slide-in and slide-out animations."""
        # Slide in from right
        self._slide_in = QPropertyAnimation(self, b"geometry")
        self._slide_in.setDuration(300)
        self._slide_in.setEasingCurve(QEasingCurve.OutQuad)

        # Slide out to right
        self._slide_out = QPropertyAnimation(self, b"geometry")
        self._slide_out.setDuration(300)
        self._slide_out.setEasingCurve(QEasingCurve.InQuad)

    def show(self) -> None:
        """Show the toast with slide-in animation."""
        # Position off-screen first
        screen_geom = self.screen().geometry()
        self.move(screen_geom.width(), screen_geom.height() - 100)
        super().show()

        # Calculate target position (bottom-right with margin)
        target_x = screen_geom.width() - self.width() - 20
        target_y = screen_geom.height() - self.height() - 20

        # Animate in
        self._slide_in.setStartValue(self.geometry())
        self._slide_in.setEndValue(self.geometry().translated(-self.width(), 0))
        self._slide_in.start()

        # Start auto-dismiss timer
        QTimer.singleShot(self._duration, self.hide)

    def hide(self) -> None:
        """Hide the toast with slide-out animation."""
        # Animate out
        screen_geom = self.screen().geometry()
        self._slide_out.setStartValue(self.geometry())
        self._slide_out.setEndValue(self.geometry().translated(self.width(), 0))
        self._slide_out.start()

        # Delete after animation completes
        self._slide_out.finished.connect(self.deleteLater)


class ToastManager(QWidget):
    """Manages toast notifications for the application.
    
    Usage:
        toast_manager = ToastManager(main_window)
        toast_manager.show_toast("Processing complete!")
        toast_manager.show_toast("Error occurred", duration=5000)
    """

    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self._toasts: list[Toast] = []
        self._parent = parent

    def show_toast(self, message: str, duration: int = 3000) -> None:
        """Show a toast notification.
        
        Args:
            message: The message to display
            duration: Duration in milliseconds before auto-dismiss (default: 3000)
        """
        toast = Toast(message, duration, self._parent)
        self._toasts.append(toast)
        
        # Position toasts in a stack (each new toast appears above the previous)
        screen_geom = self._parent.screen().geometry()
        y_offset = 20
        for existing_toast in self._toasts[:-1]:
            if existing_toast.isVisible():
                y_offset += existing_toast.height() + 10
        
        toast.move(
            screen_geom.width() - toast.width() - 20,
            screen_geom.height() - y_offset - toast.height()
        )
        
        toast.show()
        
        # Remove from list when deleted
        toast.destroyed.connect(lambda: self._toasts.remove(toast))

    def show_success(self, message: str, duration: int = 3000) -> None:
        """Show a success toast."""
        self.show_toast(message, duration)

    def show_error(self, message: str, duration: int = 5000) -> None:
        """Show an error toast."""
        self.show_toast(message, duration)

    def show_info(self, message: str, duration: int = 3000) -> None:
        """Show an info toast."""
        self.show_toast(message, duration)
