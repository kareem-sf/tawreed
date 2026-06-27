"""Settings page — provider, model, base URL, API key, test, save, reset.

Senior design choices:
- Card-based layout (one Card per logical region) instead of one
  QFormLayout stretched across the page.
- Live model fetch from the provider's own /models endpoint, with
  a curated-list fallback so the dropdown is never empty.
- "Reset everything" button at the bottom — clears config, history,
  outputs, and window state in one shot, with a typed confirmation
  to prevent misfires.
- API key field is masked but has a "show" toggle so the user can
  verify what they typed without re-typing it.
"""

from __future__ import annotations

import asyncio

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from core import db
from core import reset as reset_mod
from core.ai import (
    get_provider_config,
    get_provider_names,
    is_valid_provider,
)
from core.i18n import SUPPORTED_LANGUAGES, get_i18n
from core.model_catalog import fetch_models
from gui.widgets import Card, PageHeader, StatusPill
from gui.worker import check_connection


class SettingsPage(QWidget):
    """Provider/model/credentials configuration."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._i18n = get_i18n()
        self._loading = False  # guard against signal loops while populating UI
        self._build_ui()
        self._load_settings()

    # ----- UI construction ------------------------------------------------

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        layout.addWidget(
            PageHeader(
                "Settings",
                "Configure the LLM provider used to categorize BOQ items. "
                "Switching providers automatically updates the model list and base URL.",
            )
        )

        # ----- Provider card -----
        provider_card = Card("LLM Provider")
        self.provider_combo = QComboBox()
        for name in get_provider_names():
            cfg = get_provider_config(name)
            self.provider_combo.addItem(cfg.get("label", name), userData=name)
        self.provider_combo.currentIndexChanged.connect(self._on_provider_changed)
        provider_card.addWidget(self.provider_combo)

        self.provider_hint = QLabel("")
        self.provider_hint.setObjectName("hint")
        self.provider_hint.setWordWrap(True)
        provider_card.addWidget(self.provider_hint)
        layout.addWidget(provider_card)

        # ----- Model card -----
        model_card = Card("Model")
        model_row = QHBoxLayout()
        model_row.setSpacing(8)
        self.model_combo = QComboBox()
        self.model_combo.setEditable(True)  # custom OpenAI-Compatible lets user type
        self.model_combo.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.refresh_btn = QPushButton("↻  Refresh Models")
        self.refresh_btn.setToolTip("Fetch the live list from the provider's /models endpoint")
        self.refresh_btn.clicked.connect(self._refresh_models)
        model_row.addWidget(self.model_combo, stretch=1)
        model_row.addWidget(self.refresh_btn)
        model_card.addLayout(model_row)

        self.model_status = StatusPill()
        self.model_status.set_state("idle", "Curated list")
        model_card.addWidget(self.model_status)
        layout.addWidget(model_card)

        # ----- Language card -----
        language_card = Card("Language")
        self.language_combo = QComboBox()
        # Add language options with display names
        language_display = {
            "en": "English",
            "ar": "العربية",
        }
        for lang_code in SUPPORTED_LANGUAGES:
            self.language_combo.addItem(
                language_display.get(lang_code, lang_code), userData=lang_code
            )
        self.language_combo.currentIndexChanged.connect(self._on_language_changed)
        language_card.addWidget(self.language_combo)

        self.language_hint = QLabel("Switch between English and Arabic user interface")
        self.language_hint.setObjectName("hint")
        self.language_hint.setWordWrap(True)
        language_card.addWidget(self.language_hint)
        layout.addWidget(language_card)

        # ----- Theme card -----
        theme_card = Card("Theme")
        self.theme_combo = QComboBox()
        theme_display = {
            "dark": "Dark",
            "light": "Light",
        }
        for theme_code in ["dark", "light"]:
            self.theme_combo.addItem(theme_display.get(theme_code, theme_code), userData=theme_code)
        self.theme_combo.currentIndexChanged.connect(self._on_theme_changed)
        theme_card.addWidget(self.theme_combo)

        self.theme_hint = QLabel("Switch between dark and light color schemes")
        self.theme_hint.setObjectName("hint")
        self.theme_hint.setWordWrap(True)
        theme_card.addWidget(self.theme_hint)
        layout.addWidget(theme_card)

        # ----- Connection card -----
        conn_card = Card("Connection")
        form = QFormLayout()
        form.setSpacing(10)
        form.setLabelAlignment(Qt.AlignRight)

        self.base_url_input = QLineEdit()
        self.base_url_input.setPlaceholderText("https://...")
        form.addRow("Base URL", self.base_url_input)

        self.api_key_input = QLineEdit()
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setPlaceholderText("Paste your API key (stored locally only)")
        form.addRow("API Key", self.api_key_input)

        self.show_key_cb = QCheckBox("Show API key")
        self.show_key_cb.toggled.connect(
            lambda on: self.api_key_input.setEchoMode(
                QLineEdit.Normal if on else QLineEdit.Password
            )
        )
        form.addRow("", self.show_key_cb)

        conn_card.addLayout(form)

        action_row = QHBoxLayout()
        action_row.setSpacing(10)
        self.test_btn = QPushButton(self._i18n.tr("test_connection"))
        self.test_btn.clicked.connect(self._test_connection)
        self.save_btn = QPushButton(self._i18n.tr("save_settings"))
        self.save_btn.setObjectName("primaryBtn")
        self.save_btn.clicked.connect(self._save_settings)
        action_row.addWidget(self.test_btn)
        action_row.addStretch()
        action_row.addWidget(self.save_btn)
        conn_card.addLayout(action_row)

        self.status_label = QLabel("")
        self.status_label.setObjectName("statusLabel")
        self.status_label.setWordWrap(True)
        conn_card.addWidget(self.status_label)
        layout.addWidget(conn_card)

        # ----- Danger zone (reset) -----
        danger_card = Card("Danger Zone")
        danger_row = QHBoxLayout()
        danger_row.setSpacing(12)
        warning = QLabel(
            "Reset clears your API key, model choice, processing history, "
            "and any generated Excel files. This cannot be undone."
        )
        warning.setObjectName("hint")
        warning.setWordWrap(True)
        danger_row.addWidget(warning, stretch=1)
        self.reset_btn = QPushButton(self._i18n.tr("reset_everything"))
        self.reset_btn.setObjectName("dangerBtn")
        self.reset_btn.clicked.connect(self._confirm_reset)
        danger_row.addWidget(self.reset_btn)
        danger_card.addLayout(danger_row)
        layout.addWidget(danger_card)

        layout.addStretch(1)

    # ----- Load / save ----------------------------------------------------

    def _load_settings(self) -> None:
        settings = db.get_settings()
        self._loading = True
        try:
            provider = settings.get("provider", "OpenAI")
            if not is_valid_provider(provider):
                provider = "OpenAI"
            idx = self.provider_combo.findData(provider)
            if idx < 0:
                idx = 0
            self.provider_combo.setCurrentIndex(idx)
            # Set the provider hint to match the loaded provider so
            # the user sees the right guidance on first render (not
            # only after they pick a different provider).
            self.provider_hint.setText(get_provider_config(provider).get("hint", ""))
            # _on_provider_changed populates the model combo; we then
            # override it with the saved value if the saved model is
            # no longer in the curated list.
            self._populate_models_for_provider(provider, select_model=settings.get("model", ""))
            self.base_url_input.setText(settings.get("base_url", ""))
            self.api_key_input.setText(settings.get("api_key", ""))

            # Load language setting
            language = settings.get("language", "en")
            lang_idx = self.language_combo.findData(language)
            if lang_idx >= 0:
                self.language_combo.setCurrentIndex(lang_idx)

            # Load theme setting
            theme = settings.get("theme", "dark")
            theme_idx = self.theme_combo.findData(theme)
            if theme_idx >= 0:
                self.theme_combo.setCurrentIndex(theme_idx)
        finally:
            self._loading = False

    def _save_settings(self) -> None:
        provider = self.provider_combo.currentData() or "OpenAI"
        model = self.model_combo.currentText().strip()
        base_url = self.base_url_input.text().strip()
        api_key = self.api_key_input.text().strip()
        language = self.language_combo.currentData() or "en"
        theme = self.theme_combo.currentData() or "dark"

        cfg = get_provider_config(provider)
        if cfg.get("requires_base_url") and not base_url:
            QMessageBox.warning(
                self,
                "Base URL required",
                f"The '{cfg.get('label', provider)}' provider requires a Base URL.",
            )
            return
        if not api_key:
            QMessageBox.warning(self, "API key required", "Please enter an API key.")
            return
        if not model:
            QMessageBox.warning(self, "Model required", "Please select or type a model name.")
            return

        payload = {
            "provider": provider,
            "api_key": api_key,
            "model": model,
            "base_url": base_url,
            "language": language,
            "theme": theme,
        }
        try:
            db.save_settings(payload)
            # Update the global i18n instance to reflect the new language
            i18n = get_i18n()
            i18n.set_language(language)
            # Update the theme
            from gui.styles import load_stylesheet, set_theme

            set_theme(theme)
            # Re-apply stylesheet to main window if available
            from PySide6.QtWidgets import QApplication

            for widget in QApplication.topLevelWidgets():
                widget.setStyleSheet(load_stylesheet())
                break
        except Exception as e:
            QMessageBox.critical(
                self, self._i18n.tr("save_failed"), f"{self._i18n.tr('save_failed')}:\n{e}"
            )
            return
        self.status_label.setObjectName("statusLabelSuccess")
        self.status_label.setText("✓ Settings saved.")
        # Re-apply the style for the new objectName.
        self.status_label.style().unpolish(self.status_label)
        self.status_label.style().polish(self.status_label)

    def _on_language_changed(self, _index: int) -> None:
        """Handle language dropdown change - update i18n immediately."""
        if self._loading:
            return
        language = self.language_combo.currentData() or "en"
        i18n = get_i18n()
        i18n.set_language(language)

    def _on_theme_changed(self, _index: int) -> None:
        """Handle theme dropdown change - update theme immediately."""
        if self._loading:
            return
        theme = self.theme_combo.currentData() or "dark"
        from gui.styles import load_stylesheet, set_theme

        set_theme(theme)
        # Re-apply stylesheet to main window if available
        from PySide6.QtWidgets import QApplication

        from gui.main_window import MainWindow

        for widget in QApplication.topLevelWidgets():
            if isinstance(widget, MainWindow):
                widget.setStyleSheet(load_stylesheet())
                break

    # ----- Provider / model wiring ----------------------------------------

    def _on_provider_changed(self, _index: int) -> None:
        if self._loading:
            return
        provider = self.provider_combo.currentData() or "OpenAI"
        self._populate_models_for_provider(provider, select_model="")
        cfg = get_provider_config(provider)
        if cfg.get("base_url"):
            self.base_url_input.setText(cfg["base_url"])
        self.base_url_input.setPlaceholderText(
            "https://..." if cfg.get("requires_base_url") else cfg.get("base_url", "")
        )
        self.provider_hint.setText(cfg.get("hint", ""))
        self.status_label.setText("")

    def _populate_models_for_provider(self, provider: str, select_model: str = "") -> None:
        cfg = get_provider_config(provider)
        models = list(cfg.get("models", []))
        self.model_combo.blockSignals(True)
        try:
            self.model_combo.clear()
            self.model_combo.addItems(models)
            target = select_model or cfg.get("default_model", "")
            if target:
                idx = self.model_combo.findText(target)
                if idx >= 0:
                    self.model_combo.setCurrentIndex(idx)
                else:
                    # Add as a custom entry on top so the user's saved
                    # choice is preserved even if it's no longer in
                    # the curated list.
                    self.model_combo.insertItem(0, target)
                    self.model_combo.setCurrentIndex(0)
        finally:
            self.model_combo.blockSignals(False)
        # Show a different pill depending on the provider shape.
        if not models:
            # No curated list (OpenAI Compatible). The user is
            # expected to type a model name manually.
            self.model_status.set_state("idle", "Type a model name")
        else:
            # Has a curated list — warn the user that this may be
            # out of date; encourage them to hit Refresh.
            self.model_status.set_state(
                "warning",
                f"Curated list — {len(models)} model(s); click Refresh for live",
            )

    def _refresh_models(self) -> None:
        """Hit the live provider endpoint and replace the dropdown."""
        provider = self.provider_combo.currentData() or "OpenAI"
        api_key = self.api_key_input.text().strip()
        base_url = self.base_url_input.text().strip()

        cfg = get_provider_config(provider)
        if cfg.get("requires_base_url") and not base_url:
            QMessageBox.warning(
                self,
                "Base URL required",
                f"Enter a Base URL before refreshing '{cfg.get('label', provider)}' models.",
            )
            return
        if not api_key:
            QMessageBox.warning(
                self,
                "API key required",
                "Enter an API key so we can fetch the live model list.",
            )
            return

        self.refresh_btn.setEnabled(False)
        self.refresh_btn.setText("Fetching…")
        self.model_status.set_state("running", "Fetching live models…")

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        task = loop.create_task(fetch_models(provider, api_key=api_key, base_url=base_url))

        def on_done(future):
            self.refresh_btn.setEnabled(True)
            self.refresh_btn.setText("↻  Refresh Models")
            try:
                result = future.result()
            except Exception as e:
                self.model_status.set_state("error", f"Fetch failed: {e}")
                return

            self.model_combo.blockSignals(True)
            try:
                self.model_combo.clear()
                self.model_combo.addItems(result.models)
            finally:
                self.model_combo.blockSignals(False)

            if result.source == "live":
                self.model_status.set_state("success", f"Live list — {len(result.models)} models")
            elif result.source == "manual":
                self.model_status.set_state("idle", "Type a model name")
            else:
                self.model_status.set_state(
                    "idle",
                    f"Curated list — {result.error or 'live fetch failed'}",
                )

        task.add_done_callback(on_done)

    # ----- Test connection ------------------------------------------------

    def _test_connection(self) -> None:
        provider = self.provider_combo.currentData() or "OpenAI"
        api_key = self.api_key_input.text().strip()
        model = self.model_combo.currentText().strip()
        base_url = self.base_url_input.text().strip()

        cfg = get_provider_config(provider)
        if cfg.get("requires_base_url") and not base_url:
            QMessageBox.warning(
                self,
                "Base URL required",
                f"Enter a Base URL before testing '{cfg.get('label', provider)}'.",
            )
            return
        if not api_key:
            QMessageBox.warning(
                self, "API key required", "Enter an API key to test the connection."
            )
            return
        if not model:
            QMessageBox.warning(self, "Model required", "Pick or type a model name first.")
            return

        self.test_btn.setEnabled(False)
        self.test_btn.setText("Testing…")
        self.status_label.setText("Testing connection…")

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        task = loop.create_task(
            asyncio.to_thread(check_connection, provider, api_key, base_url, model)
        )

        def on_done(future):
            self.test_btn.setEnabled(True)
            self.test_btn.setText("Test Connection")
            try:
                success = future.result()
            except Exception as e:
                self.status_label.setText(f"Test error: {e}")
                QMessageBox.critical(self, "Test failed", f"Test error: {e}")
                return
            if success:
                self.status_label.setObjectName("statusLabelSuccess")
                self.status_label.setText("✓ Connection successful.")
                QMessageBox.information(self, "Success", self._i18n.tr("connection_successful"))
            else:
                self.status_label.setText("✗ Connection failed. Check key, URL, and model.")
                QMessageBox.critical(
                    self,
                    "Connection failed",
                    "Could not reach the API. Verify the key, base URL, and model name.",
                )

        task.add_done_callback(on_done)

    # ----- Reset ----------------------------------------------------------

    def _confirm_reset(self) -> None:
        """Two-step confirmation: dialog → typed phrase."""
        confirm = QMessageBox(self)
        confirm.setIcon(QMessageBox.Warning)
        confirm.setWindowTitle(self._i18n.tr("reset_everything_question"))
        confirm.setText(self._i18n.tr("reset_confirm_details"))
        confirm.setStandardButtons(QMessageBox.Yes | QMessageBox.Cancel)
        confirm.setDefaultButton(QMessageBox.Cancel)
        if confirm.exec() != QMessageBox.Yes:
            return

        # Second gate: type the word "RESET" to confirm.
        from PySide6.QtWidgets import QInputDialog

        phrase, ok = QInputDialog.getText(
            self,
            self._i18n.tr("reset_confirm_title"),
            self._i18n.tr("reset_confirm_body"),
        )
        if not ok or phrase.strip() != "RESET":
            self.status_label.setText("Reset cancelled.")
            return

        try:
            report = reset_mod.reset_all()
        except Exception as e:
            QMessageBox.critical(self, "Reset failed", f"Reset failed:\n{e}")
            return

        # Clear the in-memory form so the user sees the wipe.
        self.api_key_input.clear()
        self.base_url_input.clear()
        self.model_combo.clear()
        self._populate_models_for_provider(self.provider_combo.currentData() or "OpenAI")
        self.status_label.setText("✓ Everything reset.")
        QMessageBox.information(
            self,
            "Reset complete",
            f"Tawreed has been reset.\n\n{report.human_summary()}",
        )
