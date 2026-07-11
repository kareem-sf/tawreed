from __future__ import annotations

import pytest
from PySide6.QtWidgets import QPushButton, QWidget

from core.i18n import get_i18n
from gui.main_window import MainWindow


@pytest.mark.parametrize("width,height", [(960, 680), (1280, 800), (1536, 1024), (1920, 1080)])
def test_rail_and_content_scale_without_horizontal_overflow(qtbot, width, height):
    window = MainWindow()
    qtbot.addWidget(window)
    window.resize(width, height)
    window.show()
    window.select_page("workspace")
    qtbot.wait(20)

    page = window._pages["workspace"]
    assert window.navigation.width() == 220
    assert page.content.width() <= 1040
    assert page.drop_zone.width() <= 720
    assert page.drop_zone.height() == 168


def test_settings_has_four_independent_apply_actions(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)
    page = window._pages["settings"]

    apply_buttons = [
        page.connection_section.apply_button,
        page.model_section.apply_button,
        page.appearance_section.apply_button,
        page.language_section.apply_button,
    ]
    assert len(set(apply_buttons)) == 4
    assert all(button.objectName() == "primaryButton" for button in apply_buttons)
    assert page.findChild(QWidget, "settingsActions") is None


def test_workbench_copy_and_shell_match_approved_contract(qtbot):
    i18n = get_i18n()
    original = i18n.language
    try:
        i18n.set_language("en")
        window = MainWindow()
        qtbot.addWidget(window)
        page = window._pages["workspace"]

        assert page.empty_hint.text() == "Supported file: .xlsx"
        visible_text = " ".join(label.text() for label in window.findChildren(QPushButton))
        assert "BOQ rows are never displayed" not in visible_text
        assert window.findChild(QWidget, "topBar") is None
        assert window.findChild(QWidget, "appMenuButton") is None
    finally:
        i18n.set_language(original)
