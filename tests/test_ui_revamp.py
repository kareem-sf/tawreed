from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPalette
from PySide6.QtWidgets import QApplication, QLabel, QPlainTextEdit, QTableWidget, QTextEdit, QWidget

from gui.main_window import MainWindow
from gui.pages.history_page import RunListModel
from gui.run_contracts import ApprovalRequest, ApprovalSummary, RunPhase, RunProgress
from gui.styles import load_stylesheet, motion_enabled, refresh_system_theme, set_theme


def test_shell_uses_top_navigation_without_sidebar_or_tables(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)

    assert window.findChild(QWidget, "navRail") is None
    assert window._nav_buttons["workspace"].text()
    assert window._nav_buttons["history"].text()
    assert not window.findChildren(QTableWidget)
    assert window._pages["workspace"].drop_zone.minimumHeight() >= 190
    assert window._pages["settings"].findChild(QWidget, "settingsContent").maximumWidth() == 1040
    assert window._pages["history"].findChild(QWidget, "runsContent").maximumWidth() == 1240


def test_workbench_approval_is_summary_only(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)
    page = window._pages["workspace"]
    summary = ApprovalSummary(
        source_filename="sample.xlsx",
        total_items=3,
        package_counts=(("Concrete Works", 2), ("Other", 1)),
        warnings=("One item needs review in Excel.",),
        provider="Codex",
        model="account-model",
    )

    page._on_approval_ready(ApprovalRequest("opaque-token", summary))

    assert page.stack.currentWidget() is page.approval_view
    assert page.total_value.text() == "3"
    visible_labels = {label.text() for label in page.approval_view.findChildren(QLabel)}
    assert "Concrete Works" in visible_labels
    assert "Other" in visible_labels
    assert all("Reinforced concrete" not in text for text in visible_labels)
    assert not page.findChildren(QTextEdit)
    assert not page.findChildren(QPlainTextEdit)
    assert not page.findChildren(QTableWidget)


def test_run_progress_contract_supports_truthful_determinate_progress():
    progress = RunProgress(
        RunPhase.CLASSIFYING,
        "Classifying batch 2 of 4",
        current=2,
        total=4,
        elapsed_seconds=12.5,
        cancellable=True,
    )

    assert progress.current == 2
    assert progress.total == 4
    assert progress.cancellable


def test_run_list_never_displays_output_path():
    model = RunListModel(
        [
            {
                "id": 1,
                "project_name": "Tower BOQ",
                "packages_count": 7,
                "timestamp": "2026-07-10 12:00:00",
                "output_path": r"C:\secret\outputs\tower.xlsx",
            }
        ]
    )

    displayed = model.data(model.index(0, 0))
    assert "Tower BOQ" in displayed
    assert "C:\\secret" not in displayed


def test_codex_settings_hide_irrelevant_api_controls(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)
    page = window._pages["settings"]
    index = page.provider_combo.findData("Codex")
    page.provider_combo.setCurrentIndex(index)
    page._sync_provider_fields()

    assert not page.api_key_input.isVisibleTo(page)
    assert not page.base_url_input.isVisibleTo(page)
    assert page.theme_combo.findData("system") >= 0


def test_theme_change_is_applied_globally_without_window_override(qtbot):
    app = QApplication.instance()
    set_theme("dark")
    app.setStyleSheet(load_stylesheet())
    window = MainWindow()
    qtbot.addWidget(window)

    set_theme("light")
    app.setStyleSheet(load_stylesheet())

    assert "#ffffff" in app.styleSheet()
    assert window.styleSheet() == ""


def test_live_model_status_retranslates_without_refetch(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)
    page = window._pages["settings"]
    original_language = page._i18n.language
    try:
        page._set_model_status("live", 7)
        page._i18n.set_language("ar")
        page.retranslate_ui()
        assert "7" in page.model_status.text()
        assert "تم جلب" in page.model_status.text()

        page._i18n.set_language("en")
        page.retranslate_ui()
        assert page.model_status.text() == "7 account models fetched live"
    finally:
        page._i18n.set_language(original_language)


def test_reduced_motion_override(monkeypatch):
    monkeypatch.setenv("TAWREED_REDUCED_MOTION", "1")
    assert not motion_enabled()


def test_system_theme_uses_high_contrast_palette(qtbot):
    app = QApplication.instance()
    original = app.palette()
    palette = QPalette(original)
    palette.setColor(QPalette.Window, QColor("#000000"))
    palette.setColor(QPalette.Base, QColor("#000000"))
    palette.setColor(QPalette.WindowText, QColor("#ffffff"))
    palette.setColor(QPalette.Highlight, QColor("#ffff00"))
    try:
        app.setPalette(palette)
        set_theme("system")
        refresh_system_theme()
        stylesheet = load_stylesheet()
        assert "#000000" in stylesheet
        assert "#ffffff" in stylesheet
        assert "#ffff00" in stylesheet
    finally:
        app.setPalette(original)
        refresh_system_theme()


def test_system_light_palette_rejects_inverse_alternate_surface(qtbot):
    app = QApplication.instance()
    original = app.palette()
    palette = QPalette(original)
    palette.setColor(QPalette.Window, QColor("#f0f0f0"))
    palette.setColor(QPalette.Base, QColor("#ffffff"))
    palette.setColor(QPalette.AlternateBase, QColor("#000000"))
    try:
        app.setPalette(palette)
        set_theme("system")
        refresh_system_theme()
        stylesheet = load_stylesheet()
        drop_zone_rule = stylesheet.split("QPushButton#dropZone {", 1)[1].split("}", 1)[0]
        assert "background: #000000" not in drop_zone_rule
        assert "background: #f6f8fc" in drop_zone_rule
    finally:
        app.setPalette(original)
        refresh_system_theme()


def test_arabic_switch_updates_layout_and_accessible_drop_zone(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)
    original_language = window._i18n.language
    try:
        window._i18n.set_language("ar")
        assert QApplication.instance().layoutDirection() == Qt.RightToLeft
        drop_zone = window._pages["workspace"].drop_zone
        assert drop_zone.accessibleName()
        assert "Excel" in drop_zone.accessibleName()
    finally:
        window._i18n.set_language(original_language)
