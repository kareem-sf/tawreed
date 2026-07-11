"""Persistent rail application shell for Tawreed."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QGuiApplication, QKeySequence
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QMainWindow,
    QPushButton,
    QStackedWidget,
    QWidget,
)

from core import ui_state
from core.i18n import I18n, get_i18n
from gui.pages.about_page import AboutPage
from gui.pages.history_page import HistoryPage
from gui.pages.settings_page import SettingsPage
from gui.pages.workspace_page import WorkspacePage
from gui.styles import get_theme, load_stylesheet, refresh_system_theme
from gui.widgets.navigation import NavigationRail
from gui.widgets.toast import ToastManager


class MainWindow(QMainWindow):
    """Top-level shell. Business and run state stay inside the pages."""

    def __init__(self) -> None:
        super().__init__()
        self._i18n: I18n = get_i18n()
        self._pages: dict[str, QWidget] = {}
        self._nav_buttons: dict[str, QPushButton] = {}
        self._toast_manager = ToastManager(self)
        self.setMinimumSize(960, 680)
        app = QApplication.instance()
        if app and not app.styleSheet():
            app.setStyleSheet(load_stylesheet())
        self._build_ui()
        self._install_shortcuts()
        self._restore_window_state()
        self.retranslate_ui()
        self._i18n.language_changed.connect(self._on_language_changed)
        hints = QGuiApplication.styleHints()
        if hasattr(hints, "colorSchemeChanged"):
            hints.colorSchemeChanged.connect(self._on_system_theme_changed)

    def _build_ui(self) -> None:
        root = QWidget(self)
        root.setObjectName("appRoot")
        layout = QHBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.navigation = NavigationRail(root)
        self.navigation.page_selected.connect(self.select_page)
        self._nav_buttons = self.navigation.buttons
        layout.addWidget(self.navigation)
        self.rail_divider = QFrame(root)
        self.rail_divider.setObjectName("railDivider")
        self.rail_divider.setFrameShape(QFrame.VLine)
        layout.addWidget(self.rail_divider)

        self._stack = QStackedWidget(root)
        self._stack.setObjectName("pageStack")
        self._pages = {
            "workspace": WorkspacePage(),
            "history": HistoryPage(),
            "settings": SettingsPage(),
            "about": AboutPage(),
        }
        for page in self._pages.values():
            self._stack.addWidget(page)
        layout.addWidget(self._stack, 1)
        self.setCentralWidget(root)

    def _install_shortcuts(self) -> None:
        bindings = (
            ("Alt+1", "workspace"),
            ("Alt+2", "history"),
            ("Ctrl+,", "settings"),
            ("F1", "about"),
        )
        self._shortcuts: list[QAction] = []
        for sequence, page in bindings:
            action = QAction(self)
            action.setShortcut(QKeySequence(sequence))
            action.setShortcutContext(Qt.ApplicationShortcut)
            action.triggered.connect(lambda _checked=False, key=page: self.select_page(key))
            self.addAction(action)
            self._shortcuts.append(action)

    def select_page(self, key: str) -> None:
        page = self._pages.get(key)
        if page is None:
            return
        self._stack.setCurrentWidget(page)
        self.navigation.select(key)
        refresh = getattr(page, "refresh", None)
        if callable(refresh):
            refresh()

    def _restore_window_state(self) -> None:
        state = ui_state.get_ui_state()
        geometry = state.get("geometry")
        if geometry:
            self.restoreGeometry(geometry)
        else:
            self.resize(1320, 840)
        self._ensure_visible_geometry()
        last_page = state.get("last_page", "workspace")
        self.select_page(last_page if last_page in self._pages else "workspace")

    def _ensure_visible_geometry(self) -> None:
        frame = self.frameGeometry()
        screens = QGuiApplication.screens()
        if screens and not any(frame.intersects(screen.availableGeometry()) for screen in screens):
            target = QGuiApplication.primaryScreen().availableGeometry()
            self.resize(min(1320, target.width()), min(840, target.height()))
            self.move(target.center() - self.rect().center())

    def bring_to_front(self, _message: str = "") -> None:
        if self.isMinimized():
            self.showNormal()
        if not self.isVisible():
            self.show()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, event) -> None:
        current = self._stack.currentWidget()
        last_page = next((key for key, page in self._pages.items() if page is current), "workspace")
        ui_state.save_ui_state(geometry=bytes(self.saveGeometry()), last_page=last_page)
        super().closeEvent(event)

    def _on_language_changed(self, _language: str) -> None:
        direction = Qt.RightToLeft if self._i18n.language == "ar" else Qt.LeftToRight
        QGuiApplication.instance().setLayoutDirection(direction)
        self.retranslate_ui()

    def _on_system_theme_changed(self, _scheme) -> None:
        if get_theme() == "system":
            refresh_system_theme()
            app = QApplication.instance()
            if app:
                app.setStyleSheet(load_stylesheet())

    def retranslate_ui(self) -> None:
        self.setWindowTitle(self._i18n.tr("app_title"))
        self._nav_buttons["workspace"].setText(self._i18n.tr("nav_workbench"))
        self._nav_buttons["history"].setText(self._i18n.tr("nav_runs"))
        self._nav_buttons["settings"].setText(self._i18n.tr("nav_settings"))
        self._nav_buttons["about"].setText(self._i18n.tr("nav_about"))
        for page in self._pages.values():
            retranslate = getattr(page, "retranslate_ui", None)
            if callable(retranslate):
                retranslate()

    def show_toast(self, message: str, duration: int = 3000) -> None:
        self._toast_manager.show_toast(message, duration)

    def show_success_toast(self, message: str, duration: int = 3000) -> None:
        self._toast_manager.show_success(message, duration)

    def show_error_toast(self, message: str, duration: int = 5000) -> None:
        self._toast_manager.show_error(message, duration)
