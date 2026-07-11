"""Reusable page and section primitives for the desktop interface."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from gui.design_tokens import Layout, Spacing


class PageScaffold(QWidget):
    """Scrollable page with one responsive, left-aligned content column."""

    def __init__(self, *, maximum_width: int = Layout.CONTENT_MAX, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("pageHost")
        self._maximum_width = maximum_width
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea(self)
        scroll.setObjectName("pageScroll")
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        outer.addWidget(scroll)

        self.canvas = QWidget(scroll)
        self.canvas.setObjectName("pageCanvas")
        self.canvas_layout = QVBoxLayout(self.canvas)
        self.canvas_layout.setContentsMargins(
            Layout.PAGE_GUTTER, Layout.PAGE_TOP, Layout.PAGE_GUTTER, Layout.PAGE_GUTTER
        )
        scroll.setWidget(self.canvas)

        self.content = QWidget(self.canvas)
        self.content.setObjectName("pageContent")
        self.content.setMaximumWidth(maximum_width)
        self.content.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.layout = QVBoxLayout(self.content)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(Spacing.LG)
        self.canvas_layout.addWidget(self.content, 1, Qt.AlignLeft)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        available = max(480, self.width() - 2 * Layout.PAGE_GUTTER)
        self.content.setFixedWidth(min(self._maximum_width, available))


class PageHeader(QWidget):
    def __init__(self, title: str = "", subtitle: str = "", parent=None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(Spacing.XS)
        self.title = QLabel(self)
        self._title = self.title
        self.title.setObjectName("pageTitle")
        self.title.setText(title)
        self.subtitle = QLabel(self)
        self._subtitle = self.subtitle
        self.subtitle.setObjectName("pageSubtitle")
        self.subtitle.setText(subtitle)
        self.subtitle.setWordWrap(True)
        layout.addWidget(self.title)
        layout.addWidget(self.subtitle)


class SettingsSection(QWidget):
    """Open settings band with an independently owned Apply action."""

    apply_requested = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("settingsSection")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, Spacing.SM, 0, Spacing.SM)
        outer.setSpacing(Spacing.XS)
        heading_row = QHBoxLayout()
        heading_row.setContentsMargins(0, 0, 0, 0)
        self.heading = QLabel(self)
        self.heading.setObjectName("sectionTitle")
        self.apply_button = QPushButton(self)
        self.apply_button.setObjectName("primaryButton")
        self.apply_button.setMinimumHeight(Layout.BUTTON_HEIGHT)
        self.apply_button.clicked.connect(self.apply_requested)
        heading_row.addWidget(self.heading)
        heading_row.addStretch(1)
        heading_row.addWidget(self.apply_button)
        outer.addLayout(heading_row)
        self.body = QVBoxLayout()
        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(Spacing.SM)
        outer.addLayout(self.body)


__all__ = ["PageHeader", "PageScaffold", "SettingsSection"]
