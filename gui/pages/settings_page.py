"""Staged, provider-aware Settings surface."""

from __future__ import annotations

import asyncio

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from core import db
from core.ai import PROVIDERS, get_provider_config
from core.i18n import get_i18n
from core.model_catalog import fetch_models
from core.reset import reset_all
from gui.styles import load_stylesheet, set_theme
from gui.worker import check_connection


class SettingsPage(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("pageHost")
        self._i18n = get_i18n()
        self._loading = False
        self._model_task: asyncio.Task | None = None
        self._model_status_kind = "available"
        self._model_count = 0
        self._build_ui()
        self._load_settings()

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
        canvas_layout.setContentsMargins(64, 46, 64, 46)
        scroll.setWidget(canvas)

        self.content = QWidget(canvas)
        self.content.setObjectName("settingsContent")
        self.content.setMaximumWidth(1040)
        self.content.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        layout = QVBoxLayout(self.content)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(22)
        canvas_layout.addWidget(self.content, 1, Qt.AlignHCenter)

        self.title = QLabel(self.content)
        self.title.setObjectName("pageTitle")
        self.subtitle = QLabel(self.content)
        self.subtitle.setObjectName("pageSubtitle")
        self.subtitle.setWordWrap(True)
        layout.addWidget(self.title)
        layout.addWidget(self.subtitle)

        connection, connection_layout = self._section(self.content)
        self.connection_heading = self._heading(connection)
        connection_layout.addWidget(self.connection_heading)
        self.connection_form = QFormLayout()
        self.connection_form.setHorizontalSpacing(24)
        self.connection_form.setVerticalSpacing(12)
        self.provider_combo = QComboBox(connection)
        self.provider_combo.setMaximumWidth(560)
        for provider, config in PROVIDERS.items():
            self.provider_combo.addItem(config.get("label", provider), provider)
        self.provider_combo.currentIndexChanged.connect(self._provider_changed)
        self.provider_label = QLabel(connection)
        self.provider_label.setBuddy(self.provider_combo)
        self.connection_form.addRow(self.provider_label, self.provider_combo)
        self.connection_status = QLabel(connection)
        self.connection_status.setObjectName("connectionStatus")
        self.connection_status.setWordWrap(True)
        self.connection_status.setMaximumWidth(720)
        self.connection_form.addRow("", self.connection_status)
        self.api_key_input = QLineEdit(connection)
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_label = QLabel(connection)
        self.api_key_label.setBuddy(self.api_key_input)
        self.connection_form.addRow(self.api_key_label, self.api_key_input)
        self.base_url_input = QLineEdit(connection)
        self.base_url_label = QLabel(connection)
        self.base_url_label.setBuddy(self.base_url_input)
        self.connection_form.addRow(self.base_url_label, self.base_url_input)
        self.test_button = QPushButton(connection)
        self.test_button.setObjectName("secondaryButton")
        self.test_button.setMaximumWidth(190)
        self.test_button.clicked.connect(self._test_connection)
        self.connection_form.addRow("", self.test_button)
        connection_layout.addLayout(self.connection_form)
        layout.addWidget(connection)

        model_section, model_layout = self._section(self.content)
        self.model_heading = self._heading(model_section)
        model_layout.addWidget(self.model_heading)
        model_row = QHBoxLayout()
        self.model_combo = QComboBox(model_section)
        self.model_combo.setMinimumWidth(360)
        self.model_combo.setMaximumWidth(620)
        self.model_combo.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.refresh_models_button = QPushButton(model_section)
        self.refresh_models_button.setObjectName("secondaryButton")
        self.refresh_models_button.setMaximumWidth(190)
        self.refresh_models_button.clicked.connect(self._refresh_models)
        model_row.addWidget(self.model_combo, 1)
        model_row.addWidget(self.refresh_models_button)
        model_layout.addLayout(model_row)
        self.model_status = QLabel(model_section)
        self.model_status.setObjectName("hintText")
        self.model_status.setWordWrap(True)
        model_layout.addWidget(self.model_status)
        layout.addWidget(model_section)

        appearance, appearance_layout = self._section(self.content)
        self.appearance_heading = self._heading(appearance)
        appearance_layout.addWidget(self.appearance_heading)
        appearance_form = QFormLayout()
        appearance_form.setHorizontalSpacing(24)
        appearance_form.setVerticalSpacing(12)
        self.theme_combo = QComboBox(appearance)
        self.theme_combo.setMaximumWidth(520)
        self.theme_combo.addItem("System", "system")
        self.theme_combo.addItem("Light", "light")
        self.theme_combo.addItem("Dark", "dark")
        self.theme_label = QLabel(appearance)
        self.theme_label.setBuddy(self.theme_combo)
        appearance_form.addRow(self.theme_label, self.theme_combo)
        self.language_combo = QComboBox(appearance)
        self.language_combo.setMaximumWidth(520)
        self.language_combo.addItem("English", "en")
        self.language_combo.addItem("العربية", "ar")
        self.language_label = QLabel(appearance)
        self.language_label.setBuddy(self.language_combo)
        appearance_form.addRow(self.language_label, self.language_combo)
        appearance_layout.addLayout(appearance_form)
        layout.addWidget(appearance)

        self.data_toggle = QToolButton(self.content)
        self.data_toggle.setObjectName("disclosureButton")
        self.data_toggle.setCheckable(True)
        self.data_toggle.setArrowType(Qt.RightArrow)
        self.data_toggle.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        self.data_toggle.toggled.connect(self._toggle_data_reset)
        layout.addWidget(self.data_toggle)
        self.data_panel = QWidget(self.content)
        data_layout = QVBoxLayout(self.data_panel)
        data_layout.setContentsMargins(20, 0, 0, 0)
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

        actions_widget = QWidget(self.content)
        actions_widget.setObjectName("settingsActions")
        actions = QHBoxLayout(actions_widget)
        actions.setContentsMargins(0, 16, 0, 0)
        actions.addStretch(1)
        self.cancel_button = QPushButton(actions_widget)
        self.cancel_button.setObjectName("secondaryButton")
        self.cancel_button.clicked.connect(self._load_settings)
        self.apply_button = QPushButton(actions_widget)
        self.apply_button.setObjectName("primaryButton")
        self.apply_button.clicked.connect(self._save_settings)
        actions.addWidget(self.cancel_button)
        actions.addWidget(self.apply_button)
        layout.addWidget(actions_widget)
        self.retranslate_ui()

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self.content.setFixedWidth(max(760, min(1040, self.width() - 128)))

    @staticmethod
    def _section(parent: QWidget) -> tuple[QWidget, QVBoxLayout]:
        section = QWidget(parent)
        section.setObjectName("settingsSection")
        layout = QVBoxLayout(section)
        layout.setContentsMargins(0, 14, 0, 22)
        layout.setSpacing(14)
        return section, layout

    @staticmethod
    def _heading(parent: QWidget) -> QLabel:
        heading = QLabel(parent)
        heading.setObjectName("sectionTitle")
        return heading

    def _load_settings(self) -> None:
        self._loading = True
        try:
            settings = db.get_settings()
            provider = settings.get("provider", "Codex")
            index = self.provider_combo.findData(provider)
            self.provider_combo.setCurrentIndex(index if index >= 0 else 0)
            self.api_key_input.setText(settings.get("api_key", ""))
            self.base_url_input.setText(settings.get("base_url", ""))
            self.model_combo.clear()
            saved_model = settings.get("model_id") or settings.get("model", "")
            if saved_model:
                self.model_combo.addItem(saved_model)
            theme = settings.get("theme", "system")
            theme_index = self.theme_combo.findData(theme)
            self.theme_combo.setCurrentIndex(theme_index if theme_index >= 0 else 0)
            language_index = self.language_combo.findData(settings.get("language", "en"))
            self.language_combo.setCurrentIndex(language_index if language_index >= 0 else 0)
        finally:
            self._loading = False
        self._sync_provider_fields()
        self._refresh_models()

    def _provider_changed(self) -> None:
        if self._loading:
            return
        provider = self.provider_combo.currentData()
        config = get_provider_config(provider)
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
        self.connection_status.setText(
            self._i18n.tr("codex_uses_chatgpt")
            if is_codex
            else self._i18n.tr("connection_not_tested")
        )

    def _refresh_models(self) -> None:
        if self._model_task and not self._model_task.done():
            self._model_task.cancel()
        self.refresh_models_button.setEnabled(False)
        self._set_model_status("fetching")
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # Widget-only tests and static previews do not install qasync.
            # Keep the saved model visible and let the user refresh once the
            # real application event loop is running.
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
        if result.source == "live":
            self._set_model_status("live", len(result.models))
        else:
            self._set_model_status("unavailable")

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
        self.model_status.setText(text)
        self.model_status.setAccessibleName(text)

    def _test_connection(self) -> None:
        self.test_button.setEnabled(False)
        self.connection_status.setText(self._i18n.tr("testing_connection_status"))
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
        self.connection_status.setText(message)
        self.connection_status.setAccessibleName(message)
        self.connection_status.setProperty("state", "success" if result.success else "error")
        self.connection_status.style().unpolish(self.connection_status)
        self.connection_status.style().polish(self.connection_status)

    def _save_settings(self) -> None:
        provider = self.provider_combo.currentData() or "OpenAI"
        config = get_provider_config(provider)
        model = self.model_combo.currentText().strip()
        api_key = self.api_key_input.text().strip()
        base_url = self.base_url_input.text().strip()
        if config.get("requires_api_key", True) and not api_key:
            QMessageBox.warning(
                self,
                self._i18n.tr("api_key_required_title"),
                self._i18n.tr("api_key_required_message"),
            )
            return
        if config.get("requires_base_url") and not base_url:
            QMessageBox.warning(
                self,
                self._i18n.tr("base_url_required_title"),
                self._i18n.tr("base_url_required_message").format(provider=provider),
            )
            return
        if not model:
            QMessageBox.warning(
                self, self._i18n.tr("model_required_title"), self._i18n.tr("model_required_message")
            )
            return
        language = self.language_combo.currentData() or "en"
        theme = self.theme_combo.currentData() or "system"
        db.save_settings(
            {
                "provider": provider,
                "api_key": api_key,
                "model": model,
                "model_id": model,
                "base_url": base_url,
                "language": language,
                "theme": theme,
            }
        )
        self._i18n.set_language(language)
        set_theme(theme)
        app = QApplication.instance()
        if app:
            app.setStyleSheet(load_stylesheet())
        self.connection_status.setText(self._i18n.tr("settings_applied"))

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
        self.subtitle.setText(self._i18n.tr("settings_subtitle"))
        self.connection_heading.setText(self._i18n.tr("ai_connection"))
        self.provider_label.setText(self._i18n.tr("provider_label"))
        self.api_key_label.setText(self._i18n.tr("api_key_label"))
        self.base_url_label.setText(self._i18n.tr("base_url_label"))
        self.test_button.setText(self._i18n.tr("test_connection_button"))
        self.model_heading.setText(self._i18n.tr("model_label"))
        self.refresh_models_button.setText(self._i18n.tr("refresh_models_button"))
        self.appearance_heading.setText(self._i18n.tr("appearance_language"))
        self.theme_label.setText(self._i18n.tr("theme_label"))
        self.language_label.setText(self._i18n.tr("language_label"))
        self.data_toggle.setText(self._i18n.tr("data_reset"))
        self.data_warning.setText(self._i18n.tr("data_reset_warning"))
        self.reset_button.setText(self._i18n.tr("reset_everything"))
        self.cancel_button.setText(self._i18n.tr("cancel"))
        self.apply_button.setText(self._i18n.tr("apply"))
        self._sync_provider_fields()
        self._render_model_status()
