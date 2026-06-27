"""About page — author credits, version, repo, and license.

Senior design choices:
- Card-based layout. Each logical block (Author, Project, Stack,
  License, Repository) is its own Card.
- Author block centres the brand mark + name + URL — a tiny
  visual signature rather than a wall of text.
- Version is pulled from tawreed_app.__init__ at runtime so a version
  bump only needs to be done in one place.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices, QPixmap
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from core.i18n import get_i18n
from gui.assets import LOGO_PNG_PATH
from gui.widgets import Card, PageHeader
from tawreed_app import (
    __appname__,
    __author__,
    __author_url__,
    __license__,
    __repo_url__,
    __version__,
)


class AboutPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._i18n = get_i18n()
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        layout.addWidget(
            PageHeader(
                __appname__,
                self._i18n.tr("about_page_subtitle"),
            )
        )

        # ----- Author card -----
        author_card = Card(self._i18n.tr("about_author_credits"))
        body = QHBoxLayout()
        body.setSpacing(16)
        body.setContentsMargins(0, 0, 0, 0)

        mark = QLabel()
        if LOGO_PNG_PATH.exists():
            pix = QPixmap(str(LOGO_PNG_PATH)).scaled(
                72,
                72,
                Qt.KeepAspectRatio,
                Qt.SmoothTransformation,
            )
            mark.setPixmap(pix)
        else:
            mark.setText("T")
            mark.setObjectName("navBrandFallback")
        mark.setAlignment(Qt.AlignCenter)
        body.addWidget(mark)

        text_col = QVBoxLayout()
        text_col.setSpacing(2)
        name = QLabel(f"{self._i18n.tr('about_built_by')} {__author__}")
        name.setObjectName("authorName")
        text_col.addWidget(name)
        url = QLabel(f'<a href="{__author_url__}" style="color:#89b4fa;">{__author_url__}</a>')
        url.setObjectName("authorUrl")
        url.setTextFormat(Qt.RichText)
        url.setTextInteractionFlags(Qt.TextBrowserInteraction)
        url.setOpenExternalLinks(True)
        text_col.addWidget(url)
        bio = QLabel(self._i18n.tr("about_bio_text"))
        bio.setObjectName("hint")
        bio.setWordWrap(True)
        text_col.addWidget(bio)
        body.addLayout(text_col, stretch=1)
        author_card.addLayout(body)
        layout.addWidget(author_card)

        # ----- Project card -----
        project_card = Card(self._i18n.tr("about_project"))

        def _row(label: str, value: str) -> QHBoxLayout:
            r = QHBoxLayout()
            r.setSpacing(8)
            l = QLabel(label)
            l.setObjectName("metaLabel")
            l.setFixedWidth(110)
            v = QLabel(value)
            v.setObjectName("metaValue")
            v.setTextInteractionFlags(Qt.TextBrowserInteraction)
            v.setWordWrap(True)
            r.addWidget(l)
            r.addWidget(v, stretch=1)
            return r

        project_card.addLayout(_row(self._i18n.tr("about_app_name"), __appname__))
        project_card.addLayout(_row(self._i18n.tr("about_version"), f"v{__version__}"))
        project_card.addLayout(_row(self._i18n.tr("about_license"), __license__))
        project_card.addLayout(
            _row(
                self._i18n.tr("about_repository"),
                f'<a href="{__repo_url__}" style="color:#89b4fa;">{__repo_url__}</a>',
            )
        )
        project_card.addLayout(
            _row(self._i18n.tr("about_status"), self._i18n.tr("about_status_released"))
        )
        layout.addWidget(project_card)

        # ----- Stack card -----
        stack_card = Card(self._i18n.tr("about_built_with"))
        stack_card.addLayout(
            _row(self._i18n.tr("about_language"), self._i18n.tr("about_python_version"))
        )
        stack_card.addLayout(
            _row(self._i18n.tr("about_ui_framework"), self._i18n.tr("about_ui_framework_value"))
        )
        stack_card.addLayout(
            _row(self._i18n.tr("about_llm_providers"), self._i18n.tr("about_llm_providers_list"))
        )
        stack_card.addLayout(_row(self._i18n.tr("about_data"), self._i18n.tr("about_data_stack")))
        stack_card.addLayout(
            _row(self._i18n.tr("about_packaging"), self._i18n.tr("about_packaging_type"))
        )
        layout.addWidget(stack_card)

        # ----- Action row -----
        action_row = QHBoxLayout()
        action_row.setSpacing(10)
        repo_btn = QPushButton(self._i18n.tr("about_open_repository"))
        repo_btn.setObjectName("primaryBtn")
        repo_btn.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(__repo_url__)))
        author_btn = QPushButton(self._i18n.tr("about_author_website"))
        author_btn.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(__author_url__)))
        action_row.addWidget(repo_btn)
        action_row.addWidget(author_btn)
        action_row.addStretch()
        layout.addLayout(action_row)

        # ----- Footer -----
        footer = QLabel(
            f"© {__author__}. {self._i18n.tr('about_copyright_license')}: {__license__}."
        )
        footer.setObjectName("footer")
        footer.setAlignment(Qt.AlignCenter)
        layout.addWidget(footer)

        layout.addStretch(1)
