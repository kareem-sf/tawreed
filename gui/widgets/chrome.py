"""Reusable page-chrome primitives.

Senior PySide6 apps build pages out of a few small, composable
widgets — a *page header*, a *card surface*, and a *section* — rather
than than one-off QVBoxLayout + QLabel soup. This module gives the
pages in ``gui/pages/`` a shared vocabulary so the Workspace, History,
Settings, and About screens look and feel like the same product.

Design tokens (colours, radii, type) live in ``gui.styles`` and the
``.qss`` file; the helpers here just *arrange* widgets inside cards.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QVBoxLayout,
    QWidget,
)


class PageHeader(QWidget):
    """Title + optional subtitle, used at the top of every page.

    Example:
        i18n = get_i18n()
        header = PageHeader(i18n.tr("workspace_page_title"), i18n.tr("workspace_page_subtitle"))
        layout.addWidget(header)
    """

    def __init__(
        self,
        title: str,
        subtitle: str = "",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 4)
        layout.setSpacing(4)

        self._title = QLabel(title)
        self._title.setObjectName("pageTitle")
        layout.addWidget(self._title)

        if subtitle:
            self._subtitle = QLabel(subtitle)
            self._subtitle.setObjectName("pageSubtitle")
            self._subtitle.setWordWrap(True)
            layout.addWidget(self._subtitle)


class Card(QFrame):
    """A rounded surface with a soft border, used to group content.

    Cards are the building block of every page. The visual treatment
    (background, border, radius) comes from the ``QFrame#card`` rule
    in the QSS theme file; this class just provides a layout you can
    add children to.

    Example:
        i18n = get_i18n()
        with Card(i18n.tr("provider_card_title")) as card:
            card_layout = card.layout()
            card_layout.addWidget(...)
    """

    def __init__(
        self,
        title: str | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("card")
        self.setFrameShape(QFrame.NoFrame)
        # No internal margins by default — the caller (and any
        # section/label inside) provides the padding so cards stack
        # cleanly with the page header.
        self._outer = QVBoxLayout(self)
        self._outer.setContentsMargins(20, 18, 20, 18)
        self._outer.setSpacing(12)

        if title:
            heading = QLabel(title)
            heading.setObjectName("cardTitle")
            self._outer.addWidget(heading)

    def layout(self) -> QVBoxLayout:
        return self._outer

    def addWidget(self, w: QWidget) -> None:
        self._outer.addWidget(w)

    def addLayout(self, l) -> None:
        self._outer.addLayout(l)

    def addStretch(self, stretch: int = 0) -> None:
        self._outer.addStretch(stretch)


class Section(QWidget):
    """A titled sub-region inside a Card.

    Example:
        i18n = get_i18n()
        s = Section(i18n.tr("provider_card_title"))
        s.addWidget(combo_box)
        card.addWidget(s)
    """

    def __init__(
        self,
        title: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        heading = QLabel(title)
        heading.setObjectName("sectionTitle")
        layout.addWidget(heading)

        self._body = QVBoxLayout()
        self._body.setContentsMargins(0, 0, 0, 0)
        self._body.setSpacing(6)
        layout.addLayout(self._body)

    def addWidget(self, w: QWidget) -> None:
        self._body.addWidget(w)

    def addLayout(self, l) -> None:
        self._body.addLayout(l)


class StatusPill(QLabel):
    """A small colored status indicator (idle / running / success / error).

    Example:
        i18n = get_i18n()
        pill = StatusPill()
        pill.set_state("idle", i18n.tr("idle"))
        pill.set_state("running", i18n.tr("processing"))
        pill.set_state("success", i18n.tr("done"))
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("statusPill")
        self.setAlignment(Qt.AlignCenter)
        self.set_state("idle", "Idle")

    def set_state(self, kind: str, text: str) -> None:
        """Update the visual state. ``kind`` is one of idle/running/success/error."""
        self.setText(text)
        # The QSS rule for QLabel#statusPill uses the dynamic
        # property ``state`` to pick colours. Properties are
        # lowercased internally by Qt.
        self.setProperty("state", kind)
        # Re-polish so the style actually updates.
        self.style().unpolish(self)
        self.style().polish(self)
