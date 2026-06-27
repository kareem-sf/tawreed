"""Main application shell.

A QMainWindow with:
- a fixed-width left rail (navigation buttons)
- a QStackedWidget that swaps in the current page
- a status footer in the rail (version + repo link)

Pages live in ``gui/pages/``. To add a new page:
1. Create ``gui/pages/<name>_page.py`` with a ``<Name>Page(QWidget)`` class.
2. Import it below and register it in ``self._pages`` with a label.
3. Add a button in ``_build_nav()``.
"""

# Note: We deliberately do NOT import ``QSettings`` here. All
# persisted UI state lives in ``~/.tawreed/ui_state.json`` via
# ``core.ui_state``; the previous ``QSettings("sfkareem",
# "Tawreed")`` calls were the only writer to the Windows
# registry and have been removed so the architecture rule
# "every persistent state under ~/.tawreed/" holds.
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (
    QFrame,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from core import ui_state
from core.i18n import I18n, get_i18n
from gui.assets import LOGO_PNG_PATH
from gui.pages.about_page import AboutPage
from gui.pages.history_page import HistoryPage
from gui.pages.settings_page import SettingsPage
from gui.pages.workspace_page import WorkspacePage
from gui.styles import load_stylesheet
from gui.widgets.toast import ToastManager
from tawreed_app import __appname__, __version__


class MainWindow(QMainWindow):
    """Top-level shell. Holds nav + page stack; no business logic."""

    # Keyed by the page id; the label is filled in by
    # _build_nav -> retranslate_ui, so the language switch
    # only has to call retranslate_ui(), not re-build the rail.
    NAV_ITEMS = [
        ("workspace", "nav_workspace"),
        ("history", "nav_history"),
        ("settings", "nav_settings"),
        ("about", "nav_about"),
    ]

    def __init__(self):
        super().__init__()
        self._i18n: I18n = get_i18n()
        self.setWindowTitle(f"{__appname__} — {self._i18n.tr('app_title')}")
        self.setStyleSheet(load_stylesheet())

        self._nav_buttons: dict[str, QPushButton] = {}
        self._nav_label_keys: dict[str, str] = {}  # key -> i18n key
        self._pages: dict[str, QWidget] = {}
        self._toast_manager = ToastManager(self)
        self._build_ui()
        # _restore_window_state also selects the correct page.
        self._restore_window_state()
        # Initial translation. After this, the i18n signal will
        # drive future retranslate calls.
        self.retranslate_ui()
        self._i18n.language_changed.connect(self._on_language_changed)

    def _on_language_changed(self, _language: str) -> None:
        """i18n slot: retranslate the shell and every page."""
        self.retranslate_ui()

    # ----- UI construction ------------------------------------------------

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        root_layout.addWidget(self._build_nav())
        root_layout.addWidget(self._build_page_stack(), stretch=1)

    def _build_nav(self) -> QWidget:
        rail = QWidget()
        rail.setObjectName("navRail")
        rail.setFixedWidth(220)
        rail.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding)

        rail_layout = QVBoxLayout(rail)
        rail_layout.setContentsMargins(16, 24, 16, 20)
        rail_layout.setSpacing(8)

        # Brand block
        brand = QWidget()
        brand_layout = QVBoxLayout(brand)
        brand_layout.setContentsMargins(0, 0, 0, 16)
        brand_layout.setSpacing(6)

        logo_label = QLabel()
        if LOGO_PNG_PATH.exists():
            pixmap = QPixmap(str(LOGO_PNG_PATH)).scaled(
                72, 72, Qt.KeepAspectRatio, Qt.SmoothTransformation
            )
            logo_label.setPixmap(pixmap)
        else:
            logo_label.setText("TAWREED")
            logo_label.setObjectName("navBrandFallback")
        logo_label.setAlignment(Qt.AlignCenter)
        brand_layout.addWidget(logo_label)

        app_label = QLabel(self._i18n.tr("app_name_label"))
        app_label.setObjectName("navBrand")
        app_label.setAlignment(Qt.AlignCenter)
        brand_layout.addWidget(app_label)

        tagline = QLabel(self._i18n.tr("app_tagline"))
        tagline.setObjectName("navTagline")
        tagline.setAlignment(Qt.AlignCenter)
        brand_layout.addWidget(tagline)

        rail_layout.addWidget(brand)

        # Page stack — registered up here so the nav buttons can target it.
        # (The actual QStackedWidget is built in _build_page_stack; we just
        # create a reference to it via self._stack from the caller.)
        rail_layout.addSpacing(8)
        for key, i18n_key in self.NAV_ITEMS:
            btn = QPushButton(self._i18n.tr(i18n_key))
            btn.setObjectName("navButton")
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _checked=False, k=key: self.select_page(k))
            self._nav_buttons[key] = btn
            self._nav_label_keys[key] = i18n_key
            rail_layout.addWidget(btn)

        rail_layout.addStretch(1)

        # Accent stripe (visual brand mark, sits above the footer).
        stripe = QFrame()
        stripe.setObjectName("navAccentStripe")
        stripe.setFixedHeight(2)
        rail_layout.addWidget(stripe)

        footer = QLabel(f"v{__version__}  ·  {__appname__}")
        footer.setObjectName("navFooter")
        footer.setAlignment(Qt.AlignCenter)
        rail_layout.addWidget(footer)

        return rail

    def _build_page_stack(self) -> QWidget:
        container = QWidget()
        container.setObjectName("mainContainer")
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(28, 28, 28, 28)
        container_layout.setSpacing(0)

        shadow = QGraphicsDropShadowEffect()
        shadow.setBlurRadius(28)
        shadow.setColor(QColor(0, 0, 0, 120))
        shadow.setOffset(0, 8)
        container.setGraphicsEffect(shadow)

        self._stack = QStackedWidget(container)
        container_layout.addWidget(self._stack)

        # Register pages
        self._pages["workspace"] = WorkspacePage()
        self._pages["history"] = HistoryPage()
        self._pages["settings"] = SettingsPage()
        self._pages["about"] = AboutPage()
        for _key, widget in self._pages.items():
            self._stack.addWidget(widget)

        return container

    # ----- Page switching -------------------------------------------------

    def select_page(self, key: str) -> None:
        if key not in self._pages:
            return
        self._stack.setCurrentWidget(self._pages[key])
        for k, btn in self._nav_buttons.items():
            btn.setChecked(k == key)
        # If the page exposes a refresh hook (History page does), call it.
        refresh = getattr(self._pages[key], "refresh", None)
        if callable(refresh):
            try:
                refresh()
            except Exception:
                # Don't let a refresh failure prevent navigation; the page
                # itself is responsible for surfacing the error in its UI.
                pass

    # ----- Window state persistence --------------------------------------

    def _restore_window_state(self) -> None:
        # Window state lives in ``~/.tawreed/ui_state.json`` (no
        # QSettings, no registry). See ``core/ui_state.py`` for the
        # storage details.
        state = ui_state.get_ui_state()
        geometry = state.get("geometry")
        if geometry:
            self.restoreGeometry(geometry)
        else:
            self.resize(1180, 800)
        # Last-visited page (default: workspace). Use select_page so the
        # nav highlight and the page's refresh hook both fire.
        last = state.get("last_page", "workspace")
        if last in self._pages:
            self.select_page(last)

    # ----- Single-instance integration -----------------------------------

    def bring_to_front(self, _message: str = "") -> None:
        """Slot for the SingleApplication message_received signal.

        Raises and activates the window so the user sees the existing
        instance when they double-click the icon a second time.
        """
        if self.isMinimized():
            self.showNormal()
        if not self.isVisible():
            self.show()
        self.raise_()
        self.activateWindow()

    # ----- Window state persistence --------------------------------------

    def closeEvent(self, event) -> None:
        # Persist window geometry + current page. ``saveGeometry()``
        # returns a QByteArray; ``core.ui_state`` base64-encodes it
        # so the file is plain JSON and stays under ~/.tawreed/.
        last_page = "workspace"
        current = self._stack.currentWidget()
        for key, widget in self._pages.items():
            if widget is current:
                last_page = key
                break
        ui_state.save_ui_state(
            geometry=bytes(self.saveGeometry()),
            last_page=last_page,
        )
        super().closeEvent(event)

    # ----- i18n -----------------------------------------------------------

    def retranslate_ui(self) -> None:
        """Re-translate the shell and every registered page.

        Called once during __init__ (initial render) and again
        every time the i18n object emits ``language_changed``.
        """
        # Window title: just the app name (translated).
        self.setWindowTitle(self._i18n.tr("app_title"))
        # Nav button labels.
        for key, i18n_key in self._nav_label_keys.items():
            if key in self._nav_buttons:
                self._nav_buttons[key].setText(self._i18n.tr(i18n_key))
        # Each page can implement retranslate_ui() too. Pages that
        # don't define it are silently skipped.
        for page in self._pages.values():
            retranslate = getattr(page, "retranslate_ui", None)
            if callable(retranslate):
                try:
                    retranslate()
                except Exception:
                    # Don't let a translation failure break the
                    # rest of the shell; the page itself can log
                    # if it wants to.
                    pass

    # ----- Toast notifications -----------------------------------------------

    def show_toast(self, message: str, duration: int = 3000) -> None:
        """Show a toast notification."""
        self._toast_manager.show_toast(message, duration)

    def show_success_toast(self, message: str, duration: int = 3000) -> None:
        """Show a success toast notification."""
        self._toast_manager.show_success(message, duration)

    def show_error_toast(self, message: str, duration: int = 5000) -> None:
        """Show an error toast notification."""
        self._toast_manager.show_error(message, duration)
