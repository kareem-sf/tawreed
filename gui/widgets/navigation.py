"""Persistent navigation rail matching Tawreed's approved desktop concept."""

from __future__ import annotations

from PySide6.QtCore import QByteArray, QSize, Qt, Signal
from PySide6.QtGui import QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (
    QButtonGroup,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from gui.assets import LOGO_PNG_PATH
from gui.design_tokens import Layout, Spacing
from tawreed_app import __appname__

_SVG_BODIES = {
    "workspace": (
        '<rect x="3" y="3" width="7" height="7" rx="1"/>'
        '<rect x="14" y="3" width="7" height="7" rx="1"/>'
        '<rect x="3" y="14" width="7" height="7" rx="1"/>'
        '<rect x="14" y="14" width="7" height="7" rx="1"/>'
    ),
    "history": '<path d="M3 17l5-5 4 3 8-9"/><path d="M16 6h4v4"/>',
    "settings": (
        '<circle cx="12" cy="12" r="3.2"/>'
        '<path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'
    ),
    "about": '<circle cx="12" cy="12" r="9"/><path d="M12 10v7"/><path d="M12 7h.01"/>',
}


def _svg_icon(name: str) -> QIcon:
    icon = QIcon()
    for checked, color in ((False, "#536173"), (True, "#075fc7")):
        pixmap = QPixmap(24, 24)
        pixmap.fill(Qt.transparent)
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" '
            'viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-width="1.8" stroke-linecap="round" '
            f'stroke-linejoin="round">{_SVG_BODIES[name]}</svg>'
        )
        renderer = QSvgRenderer(QByteArray(svg.encode("utf-8")))
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing)
        renderer.render(painter)
        painter.end()
        icon.addPixmap(pixmap, QIcon.Normal, QIcon.On if checked else QIcon.Off)
    return icon


class NavigationRail(QWidget):
    page_selected = Signal(str)

    _ITEMS = ("workspace", "history", "settings", "about")

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("navRail")
        self.setFixedWidth(Layout.NAV_RAIL_WIDTH)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(Spacing.LG, Spacing.XXL, Spacing.MD, Spacing.LG)
        layout.setSpacing(Spacing.XS)

        brand = QWidget(self)
        brand.setObjectName("railBrand")
        brand_layout = QHBoxLayout(brand)
        brand_layout.setContentsMargins(Spacing.SM, 0, 0, Spacing.XL)
        brand_layout.setSpacing(Spacing.MD)
        self.logo = QLabel(brand)
        self.logo.setObjectName("railLogo")
        self.logo.setAccessibleName("Tawreed logo")
        if LOGO_PNG_PATH.exists():
            self.logo.setPixmap(
                QPixmap(str(LOGO_PNG_PATH)).scaled(
                    42, 42, Qt.KeepAspectRatio, Qt.SmoothTransformation
                )
            )
        self.brand = QLabel(__appname__, brand)
        self.brand.setObjectName("railBrandName")
        brand_layout.addWidget(self.logo, 0, Qt.AlignVCenter)
        brand_layout.addWidget(self.brand, 1, Qt.AlignVCenter)
        layout.addWidget(brand)

        self.buttons: dict[str, QPushButton] = {}
        group = QButtonGroup(self)
        group.setExclusive(True)
        for key in self._ITEMS:
            button = QPushButton(self)
            button.setObjectName("navButton")
            button.setCheckable(True)
            button.setIcon(_svg_icon(key))
            button.setIconSize(QSize(24, 24))
            button.setMinimumHeight(Layout.NAV_ITEM_HEIGHT)
            button.setCursor(Qt.PointingHandCursor)
            button.clicked.connect(lambda _checked=False, page=key: self.page_selected.emit(page))
            group.addButton(button)
            self.buttons[key] = button
            layout.addWidget(button)
        layout.addStretch(1)

    def select(self, key: str) -> None:
        if key in self.buttons:
            self.buttons[key].setChecked(True)


__all__ = ["NavigationRail"]
