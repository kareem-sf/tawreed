"""Minimal About surface."""

from __future__ import annotations

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices, QPixmap
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

from core.i18n import get_i18n
from gui.assets import LOGO_PNG_PATH
from tawreed_app import (
    __appname__,
    __author__,
    __author_url__,
    __license__,
    __repo_url__,
    __version__,
)


class AboutPage(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("pageHost")
        self._i18n = get_i18n()
        self._build_ui()

    def _build_ui(self) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea(self)
        scroll.setObjectName("pageScroll")
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        outer.addWidget(scroll)
        canvas = QWidget(scroll)
        canvas.setObjectName("pageCanvas")
        canvas_layout = QVBoxLayout(canvas)
        canvas_layout.setContentsMargins(64, 48, 64, 48)
        scroll.setWidget(canvas)

        self.content = QFrame(canvas)
        self.content.setObjectName("aboutContent")
        self.content.setMaximumWidth(900)
        self.content.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        layout = QVBoxLayout(self.content)
        layout.setContentsMargins(34, 32, 34, 32)
        layout.setSpacing(16)
        canvas_layout.addWidget(self.content, 1, Qt.AlignHCenter)

        self.mark = QLabel(self.content)
        if LOGO_PNG_PATH.exists():
            self.mark.setPixmap(
                QPixmap(str(LOGO_PNG_PATH)).scaled(
                    64, 64, Qt.KeepAspectRatio, Qt.SmoothTransformation
                )
            )
        self.mark.setAccessibleName("Tawreed logo")
        layout.addWidget(self.mark, 0, Qt.AlignLeft)
        self.title = QLabel(__appname__, self.content)
        self.title.setObjectName("pageTitle")
        self.version = QLabel(f"v{__version__}", self.content)
        self.version.setObjectName("aboutVersion")
        self.description = QLabel(self.content)
        self.description.setObjectName("pageSubtitle")
        self.description.setWordWrap(True)
        layout.addWidget(self.title)
        layout.addWidget(self.version)
        layout.addWidget(self.description)
        layout.addSpacing(16)

        self.product_heading = QLabel(self.content)
        self.product_heading.setObjectName("sectionTitle")
        self.product_text = QLabel(self.content)
        self.product_text.setWordWrap(True)
        self.product_text.setObjectName("bodyText")
        layout.addWidget(self.product_heading)
        layout.addWidget(self.product_text)
        layout.addSpacing(12)

        self.privacy_heading = QLabel(self.content)
        self.privacy_heading.setObjectName("sectionTitle")
        self.privacy_text = QLabel(self.content)
        self.privacy_text.setWordWrap(True)
        self.privacy_text.setObjectName("bodyText")
        layout.addWidget(self.privacy_heading)
        layout.addWidget(self.privacy_text)
        layout.addStretch(1)

        actions = QHBoxLayout()
        self.repo_button = QPushButton(self.content)
        self.repo_button.setObjectName("primaryButton")
        self.repo_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(__repo_url__)))
        self.author_button = QPushButton(self.content)
        self.author_button.setObjectName("secondaryButton")
        self.author_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(__author_url__)))
        actions.addWidget(self.repo_button)
        actions.addWidget(self.author_button)
        actions.addStretch(1)
        layout.addLayout(actions)
        self.footer = QLabel(f"{__author__} · {__license__}", self.content)
        self.footer.setObjectName("hintText")
        layout.addWidget(self.footer)
        self.retranslate_ui()

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self.content.setFixedWidth(max(640, min(900, self.width() - 128)))

    def retranslate_ui(self) -> None:
        self.description.setText(self._i18n.tr("about_page_subtitle"))
        self.product_heading.setText(self._i18n.tr("about_product_heading"))
        self.product_text.setText(self._i18n.tr("about_product_text"))
        self.privacy_heading.setText(self._i18n.tr("about_privacy_heading"))
        self.privacy_text.setText(self._i18n.tr("about_privacy_text"))
        self.repo_button.setText(self._i18n.tr("about_open_repository"))
        self.author_button.setText(self._i18n.tr("about_author_website"))
