"""Independent, provider-aware Settings sections."""

from __future__ import annotations

import asyncio

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFormLayout,
    QFrame,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from core.ai import PROVIDERS, get_provider_config
from core.i18n import get_i18n
from core.model_catalog import fetch_models
from core.reset import reset_all
from core.settings_service import SettingsService, SettingsValidationError
from gui.styles import load_stylesheet, set_theme
from gui.widgets.chrome import PageHeader, PageScaffold, SettingsSection
from gui.worker import check_connection


class SettingsPage(QWidget):
    """Settings view with one transaction boundary per visible section."""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._i18n = get_i18n()
        self._service = SettingsService()
        self._loading = False
        self._model_task: asyncio.Task | None = None
        self._model_status_kind = "available"
        self._model_count = 0
        self._build_ui()
        self._load_settings()

    def _build_ui(self) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        self.scaffold = PageScaffold(parent=self)
        outer.addWidget(self.scaffold)
        self.content = self.scaffold.content
        layout = self.scaffold.layout
        layout.setSpacing(0)

        self.header = PageHeader(parent=self.content)
        self.title = self.header.title
        self.subtitle = self.header.subtitle
        self.subtitle.hide()
        layout.addWidget(self.header)
        layout.addSpacing(16)

        self.connection_section = SettingsSection(self.content)
        self.connection_heading = self.connection_section.heading
        self.connection_section.apply_requested.connect(self._apply_connection)
        connection_form = QFormLayout()
        connection_form.setHorizontalSpacing(24)
        connection_form.setVerticalSpacing(12)
        self.provider_combo = QComboBox(self.connection_section)
        self.provider_combo.setMaximumWidth(560)
        for provider, config in PROVIDERS.items():
            self.provider_combo.addItem(config.get("label", provider), provider)
        self.provider_combo.currentIndexChanged.connect(self._provider_changed)
        self.provider_label = QLabel(self.connection_section)
        self.provider_label.setBuddy(self.provider_combo)
        connection_form.addRow(self.provider_label, self.provider_combo)
        self.api_key_input = QLineEdit(self.connection_section)
        self.api_key_input.setMaximumWidth(560)
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_label = QLabel(self.connection_section)
        self.api_key_label.setBuddy(self.api_key_input)
        connection_form.addRow(self.api_key_label, self.api_key_input)
        self.base_url_input = QLineEdit(self.connection_section)
        self.base_url_input.setMaximumWidth(560)
        self.base_url_label = QLabel(self.connection_section)
        self.base_url_label.setBuddy(self.base_url_input)
        connection_form.addRow(self.base_url_label, self.base_url_input)
        self.connection_status = self._status_label(self.connection_section)
        self.connection_status.setMaximumWidth(720)
        connection_form.addRow("", self.connection_status)
        self.test_button = QPushButton(self.connection_section)
        self.test_button.setObjectName("secondaryButton")
        self.test_button.setMaximumWidth(180)
        self.test_button.clicked.connect(self._test_connection)
        connection_form.addRow("", self.test_button)
        self.connection_section.body.addLayout(connection_form)
        layout.addWidget(self.connection_section)
        layout.addWidget(self._divider(self.content))

        self.model_section = SettingsSection(self.content)
        self.model_heading = self.model_section.heading
        self.model_section.apply_requested.connect(self._apply_model)
        self.model_combo = QComboBox(self.model_section)
        self.model_combo.setMinimumWidth(320)
        self.model_combo.setMaximumWidth(380)
        self.model_combo.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.model_section.body.addWidget(self.model_combo, 0, Qt.AlignLeft)
        self.model_status = self._status_label(self.model_section)
        self.model_section.body.addWidget(self.model_status)
        self.refresh_models_button = QPushButton(self.model_section)
        self.refresh_models_button.setObjectName("secondaryButton")
        self.refresh_models_button.clicked.connect(self._refresh_models)
        self.model_section.body.addWidget(self.refresh_models_button, 0, Qt.AlignLeft)
        layout.addWidget(self.model_section)
        layout.addWidget(self._divider(self.content))

        self.appearance_section = SettingsSection(self.content)
        self.appearance_heading = self.appearance_section.heading
        self.appearance_section.apply_requested.connect(self._apply_appearance)
        appearance_form = QFormLayout()
        appearance_form.setHorizontalSpacing(24)
        self.theme_combo = QComboBox(self.appearance_section)
        self.theme_combo.setMaximumWidth(380)
        self.theme_label = QLabel(self.appearance_section)
        self.theme_label.setBuddy(self.theme_combo)
        appearance_form.addRow(self.theme_label, self.theme_combo)
        self.appearance_section.body.addLayout(appearance_form)
        self.appearance_status = self._status_label(self.appearance_section)
        self.appearance_section.body.addWidget(self.appearance_status)
        layout.addWidget(self.appearance_section)
        layout.addWidget(self._divider(self.content))

        self.language_section = SettingsSection(self.content)
        self.language_heading = self.language_section.heading
        self.language_section.apply_requested.connect(self._apply_language)
        language_form = QFormLayout()
        language_form.setHorizontalSpacing(24)
        self.language_combo = QComboBox(self.language_section)
        self.language_combo.setMaximumWidth(380)
        self.language_combo.addItem("English", "en")
        self.language_combo.addItem("العربية", "ar")
        self.language_label = QLabel(self.language_section)
        self.language_label.setBuddy(self.language_combo)
        language_form.addRow(self.language_label, self.language_combo)
        self.language_section.body.addLayout(language_form)
        self.language_status = self._status_label(self.language_section)
        self.language_section.body.addWidget(self.language_status)
        layout.addWidget(self.language_section)
        layout.addWidget(self._divider(self.content))

        self.data_toggle = QToolButton(self.content)
        self.data_toggle.setObjectName("disclosureButton")
        self.data_toggle.setCheckable(True)
        self.data_toggle.setArrowType(Qt.RightArrow)
        self.data_toggle.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        self.data_toggle.toggled.connect(self._toggle_data_reset)
        layout.addWidget(self.data_toggle)
        self.data_panel = QWidget(self.content)
        data_layout = QVBoxLayout(self.data_panel)
        data_layout.setContentsMargins(16, 0, 0, 24)
        self.data_warning = QLabel(self.data_panel)
        self.data_warning.setObjectName("warningText")
        self.data_warning.setWordWrap(True)
        self.reset_button = QPushButton(self.data_panel)
        self.reset_button.setObjectName("dangerButton")
        self.reset_button.clicked.connect(self._reset_everything)
        data_layout.addWidget(self.data_warning)
        data_layout.addWidget(self.reset_button, 0, Qt.AlignLeft)
        self.data_panel.hide()
        layout.addWidget(self.data_panel)
        layout.addStretch(1)
        self.retranslate_ui()

    @staticmethod
    def _status_label(parent: QWidget) -> QLabel:
        label = QLabel(parent)
        label.setObjectName("sectionStatus")
        label.setWordWrap(True)
        label.setProperty("state", "neutral")
        return label

    @staticmethod
    def _divider(parent: QWidget) -> QFrame:
        divider = QFrame(parent)
        divider.setObjectName("settingsDivider")
        divider.setFrameShape(QFrame.HLine)
        return divider

    def refresh(self) -> None:
        """Discard staged edits whenever the user returns to Settings."""

        self._load_settings()

    def _load_settings(self) -> None:
        self._loading = True
        try:
            settings = self._service.load()
            index = self.provider_combo.findData(settings.provider)
            self.provider_combo.setCurrentIndex(index if index >= 0 else 0)
            self.api_key_input.setText(settings.api_key)
            self.base_url_input.setText(settings.base_url)
            self.model_combo.clear()
            if settings.model:
                self.model_combo.addItem(settings.model)
            theme_index = self.theme_combo.findData(settings.theme)
            self.theme_combo.setCurrentIndex(theme_index if theme_index >= 0 else 0)
            language_index = self.language_combo.findData(settings.language)
            self.language_combo.setCurrentIndex(language_index if language_index >= 0 else 0)
        finally:
            self._loading = False
        self._clear_apply_statuses()
        self._sync_provider_fields()
        self._refresh_models()

    def _provider_changed(self) -> None:
        if self._loading:
            return
        config = get_provider_config(self.provider_combo.currentData() or "OpenAI")
        self.base_url_input.setText(config.get("base_url", ""))
        self.model_combo.clear()
        self._sync_provider_fields()
        self._refresh_models()

    def _sync_provider_fields(self) -> None:
        provider = self.provider_combo.currentData() or "OpenAI"
        is_codex = get_provider_config(provider).get("transport") == "codex_cli"
        self.api_key_label.setVisible(not is_codex)
        self.api_key_input.setVisible(not is_codex)
        self.base_url_label.setVisible(not is_codex)
        self.base_url_input.setVisible(not is_codex)
        self.model_combo.setEditable(not is_codex)
        self._set_status(
            self.connection_status,
            self._i18n.tr("codex_uses_chatgpt")
            if is_codex
            else self._i18n.tr("connection_not_tested"),
        )

    def _refresh_models(self) -> None:
        if self._model_task and not self._model_task.done():
            self._model_task.cancel()
        self.refresh_models_button.setEnabled(False)
        self._set_model_status("fetching")
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            self.refresh_models_button.setEnabled(True)
            self._set_model_status("available")
            return
        self._model_task = loop.create_task(self._fetch_models())

    async def _fetch_models(self) -> None:
        provider = self.provider_combo.currentData() or "OpenAI"
        saved = self.model_combo.currentText().strip()
        result = await fetch_models(
            provider,
            self.api_key_input.text().strip(),
            self.base_url_input.text().strip(),
        )
        if provider != (self.provider_combo.currentData() or "OpenAI"):
            return
        self.model_combo.blockSignals(True)
        self.model_combo.clear()
        self.model_combo.addItems(result.models)
        target = saved or result.default_model
        if target:
            index = self.model_combo.findText(target)
            if index < 0 and self.model_combo.isEditable():
                self.model_combo.addItem(target)
                index = self.model_combo.findText(target)
            if index >= 0:
                self.model_combo.setCurrentIndex(index)
        self.model_combo.blockSignals(False)
        self.refresh_models_button.setEnabled(True)
        self._set_model_status("live" if result.source == "live" else "unavailable", len(result.models))

    def _set_model_status(self, kind: str, count: int = 0) -> None:
        self._model_status_kind = kind
        self._model_count = count
        self._render_model_status()

    def _render_model_status(self) -> None:
        if self._model_status_kind == "fetching":
            text = self._i18n.tr("fetching_models")
        elif self._model_status_kind == "live":
            text = self._i18n.tr("live_models_count").format(count=self._model_count)
        elif self._model_status_kind == "unavailable":
            text = self._i18n.tr("models_unavailable")
        else:
            text = self._i18n.tr("models_refresh_available")
        self._set_status(self.model_status, text)

    def _test_connection(self) -> None:
        self.test_button.setEnabled(False)
        self._set_status(self.connection_status, self._i18n.tr("testing_connection_status"))
        asyncio.ensure_future(self._run_connection_test())

    async def _run_connection_test(self) -> None:
        result = await asyncio.to_thread(
            check_connection,
            self.provider_combo.currentData() or "OpenAI",
            self.api_key_input.text().strip(),
            self.base_url_input.text().strip(),
            self.model_combo.currentText().strip(),
        )
        self.test_button.setEnabled(True)
        provider = self.provider_combo.currentData() or "OpenAI"
        if result.success and provider == "Codex":
            message = self._i18n.tr("codex_connection_success").format(
                count=self.model_combo.count()
            )
        elif result.success:
            message = self._i18n.tr("connection_successful_status")
        else:
            message = self._i18n.tr("connection_failed_status")
        self._set_status(self.connection_status, message, "success" if result.success else "error")

    def _apply_connection(self) -> None:
        try:
            self._service.save_ai_connection(
                self.provider_combo.currentData() or "OpenAI",
                self.api_key_input.text(),
                self.base_url_input.text(),
                (self.model_combo.itemText(i) for i in range(self.model_combo.count())),
            )
        except SettingsValidationError as exc:
            self._set_status(self.connection_status, str(exc), "error")
            return
        self._applied(self.connection_status)
        self._refresh_models()

    def _apply_model(self) -> None:
        try:
            self._service.save_model(self.model_combo.currentText())
        except SettingsValidationError as exc:
            self._set_status(self.model_status, str(exc), "error")
            return
        self._applied(self.model_status)

    def _apply_appearance(self) -> None:
        try:
            settings = self._service.save_appearance(self.theme_combo.currentData() or "system")
        except SettingsValidationError as exc:
            self._set_status(self.appearance_status, str(exc), "error")
            return
        set_theme(settings.theme)
        app = QApplication.instance()
        if app:
            app.setStyleSheet(load_stylesheet())
        self._applied(self.appearance_status)

    def _apply_language(self) -> None:
        try:
            settings = self._service.save_language(self.language_combo.currentData() or "en")
        except SettingsValidationError as exc:
            self._set_status(self.language_status, str(exc), "error")
            return
        self._i18n.set_language(settings.language)
        self._applied(self.language_status)

    def _save_settings(self) -> None:
        """Legacy all-sections hook retained for existing callers and tests."""

        self._apply_connection()
        self._apply_model()
        self._apply_appearance()
        self._apply_language()

    def _applied(self, label: QLabel) -> None:
        message = self._i18n.tr("settings_applied")
        self._set_status(label, message, "success")
        window = self.window()
        show = getattr(window, "show_success_toast", None)
        if callable(show):
            show(message, 2200)

    @staticmethod
    def _set_status(label: QLabel, message: str, state: str = "neutral") -> None:
        label.setText(message)
        label.setAccessibleName(message)
        label.setProperty("state", state)
        label.style().unpolish(label)
        label.style().polish(label)

    def _clear_apply_statuses(self) -> None:
        for label in (self.appearance_status, self.language_status):
            self._set_status(label, "")

    def _toggle_data_reset(self, checked: bool) -> None:
        self.data_toggle.setArrowType(Qt.DownArrow if checked else Qt.RightArrow)
        self.data_panel.setVisible(checked)

    def _reset_everything(self) -> None:
        answer = QMessageBox.question(
            self,
            self._i18n.tr("reset_everything"),
            self._i18n.tr("reset_confirm"),
            QMessageBox.Yes | QMessageBox.Cancel,
            QMessageBox.Cancel,
        )
        if answer != QMessageBox.Yes:
            return
        report = reset_all()
        QMessageBox.information(self, self._i18n.tr("reset_complete"), report.human_summary())
        self._load_settings()

    def _on_theme_changed(self, _index: int) -> None:
        """Compatibility hook retained for older tests; settings remain staged."""

    def retranslate_ui(self) -> None:
        selected_theme = self.theme_combo.currentData() or "system"
        self.theme_combo.blockSignals(True)
        self.theme_combo.clear()
        self.theme_combo.addItem(self._i18n.tr("theme_system"), "system")
        self.theme_combo.addItem(self._i18n.tr("theme_light"), "light")
        self.theme_combo.addItem(self._i18n.tr("theme_dark"), "dark")
        theme_index = self.theme_combo.findData(selected_theme)
        self.theme_combo.setCurrentIndex(theme_index if theme_index >= 0 else 0)
        self.theme_combo.blockSignals(False)
        self.title.setText(self._i18n.tr("settings_title"))
        self.subtitle.setText(self._i18n.tr("settings_subtitle_sections"))
        self.connection_heading.setText(self._i18n.tr("ai_connection"))
        self.provider_label.setText(self._i18n.tr("provider_label"))
        self.api_key_label.setText(self._i18n.tr("api_key_label"))
        self.base_url_label.setText(self._i18n.tr("base_url_label"))
        self.test_button.setText(self._i18n.tr("test_connection_button"))
        self.model_heading.setText(self._i18n.tr("model_label"))
        self.refresh_models_button.setText(self._i18n.tr("refresh_models_button"))
        self.appearance_heading.setText(self._i18n.tr("appearance_section"))
        self.theme_label.setText(self._i18n.tr("theme_label"))
        self.language_heading.setText(self._i18n.tr("language_section"))
        self.language_label.setText(self._i18n.tr("language_label"))
        for section in (
            self.connection_section,
            self.model_section,
            self.appearance_section,
            self.language_section,
        ):
            section.apply_button.setText(self._i18n.tr("apply"))
        self.data_toggle.setText(self._i18n.tr("data_reset"))
        self.data_warning.setText(self._i18n.tr("data_reset_warning"))
        self.reset_button.setText(self._i18n.tr("reset_everything"))
        self._sync_provider_fields()
        self._render_model_status()
