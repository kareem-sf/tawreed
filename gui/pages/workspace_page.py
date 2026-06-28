"""Workspace page — the BOQ processing entry point.

Senior design choices:
- Card-based layout: one card for input controls, one for the
  live console. The two cards don't compete for vertical space.
- Status pill in the header so the user knows the current state
  (idle / running / success / error) without scanning the console.
- Larger console with monospace font and explicit "Clear log"
  action so long runs are easier to triage.
- Drop zone visual: a clickable card that opens the file picker,
  with a primary "Start Processing" button that lights up only
  when a file is selected.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QDragEnterEvent, QDropEvent
from PySide6.QtWidgets import (
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from core import db
from core.i18n import I18n, get_i18n
from gui.widgets import Card, PageHeader, StatusPill
from gui.worker import BOQProcessor, WorkerSignals

log = logging.getLogger(__name__)


class _DropZone(QFrame):
    """Drop zone for BOQ Excel files (.xlsx only).

    Shows a drag-and-drop surface with a title and subtitle. When a file is dropped
    or the browse dialog (button click) or by dragging an .xlsx onto the surface.
    """

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("dropZone")
        self.setAcceptDrops(True)
        self.setMinimumHeight(110)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(4)
        i18n = get_i18n()
        self._title = QLabel(i18n.tr("drop_zone_title"))
        self._title.setObjectName("dropZoneTitle")
        self._title.setAlignment(Qt.AlignCenter)
        self._subtitle = QLabel(i18n.tr("drop_zone_subtitle"))
        self._subtitle.setObjectName("dropZoneSubtitle")
        self._subtitle.setAlignment(Qt.AlignCenter)
        layout.addStretch()
        layout.addWidget(self._title)
        layout.addWidget(self._subtitle)
        layout.addStretch()

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self._open_dialog()
            event.accept()
        else:
            super().mousePressEvent(event)

    def _open_dialog(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, self._i18n.tr("file_dialog_title"), "", self._i18n.tr("file_dialog_filter")
        )
        if path:
            # Walk up to the QWidget that owns a file_selected handler.
            w: QWidget = self
            while w is not None and not hasattr(w, "file_selected"):
                w = w.parentWidget()
            if w is not None:
                w.file_selected.emit(path)  # type: ignore[attr-defined]

    # ----- drag & drop ----------------------------------------------------

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event: QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event: QDropEvent) -> None:
        urls = event.mimeData().urls()
        if not urls:
            event.ignore()
            return
        path = Path(urls[0].toLocalFile())
        if not path.exists():
            event.ignore()
            return
        w: QWidget = self
        while w is not None and not hasattr(w, "file_selected"):
            w = w.parentWidget()
        if w is not None:
            w.file_selected.emit(str(path))  # type: ignore[attr-defined]
            event.acceptProposedAction()
        else:
            event.ignore()


class WorkspacePage(QWidget):
    """The main BOQ processing workspace."""

    from PySide6.QtCore import Signal

    file_selected = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._i18n: I18n = get_i18n()
        self.selected_file: str | None = None
        self.signals: WorkerSignals | None = None
        self._last_output_path: str | None = None
        self._build_ui()
        self.file_selected.connect(self._on_file_selected)
        self.setFocusPolicy(Qt.StrongFocus)

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        # ----- Header + status pill -----
        header_row = QHBoxLayout()
        header_row.setSpacing(12)
        header = PageHeader(
            self._i18n.tr("workspace_page_title"),
            self._i18n.tr("workspace_page_subtitle"),
        )
        header_row.addWidget(header, stretch=1)
        self.status_pill = StatusPill()
        self.status_pill.set_state("idle", "Idle")
        header_row.addWidget(self.status_pill, alignment=Qt.AlignTop)
        layout.addLayout(header_row)

        # ----- Input card (drop zone + actions) -----
        input_card = Card("Input")

        self.drop_zone = _DropZone()
        input_card.addWidget(self.drop_zone)

        # Recent files list
        self.recent_files_label = QLabel(self._i18n.tr("recent_files_label"))
        self.recent_files_label.setObjectName("hint")
        self.recent_files_label.setVisible(False)
        input_card.addWidget(self.recent_files_label)

        self.recent_files_container = QHBoxLayout()
        self.recent_files_container.setSpacing(8)
        self.recent_files_container.setContentsMargins(0, 0, 0, 0)
        input_card.addLayout(self.recent_files_container)

        self.file_label = QLabel(self._i18n.tr("no_file_selected"))
        self.file_label.setObjectName("fileLabel")
        input_card.addWidget(self.file_label)

        # Populate recent files on startup
        self._refresh_recent_files()

        actions = QHBoxLayout()
        actions.setSpacing(10)
        self.browse_btn = QPushButton(self._i18n.tr("select_file"))
        self.browse_btn.clicked.connect(self.browse_file)
        self.clear_btn = QPushButton(self._i18n.tr("clear"))
        self.clear_btn.setObjectName("ghostBtn")
        self.clear_btn.setEnabled(False)
        self.clear_btn.clicked.connect(self._clear_selection)
        self.process_btn = QPushButton(
            self._i18n.tr("process_button_prefix") + self._i18n.tr("process_button")
        )
        self.process_btn.setObjectName("primaryBtn")
        self.process_btn.setEnabled(False)
        self.process_btn.clicked.connect(self.start_processing)
        # "Open output" and "Show in folder" are enabled only after
        # a successful run — see on_processing_finished().
        self.open_output_btn = QPushButton(self._i18n.tr("open_output"))
        self.open_output_btn.setObjectName("ghostBtn")
        self.open_output_btn.setEnabled(False)
        self.open_output_btn.setToolTip(self._i18n.tr("open_output_tooltip"))
        self.open_output_btn.clicked.connect(self._open_last_output)
        self.open_folder_btn = QPushButton(self._i18n.tr("show_in_folder"))
        self.open_folder_btn.setObjectName("ghostBtn")
        self.open_folder_btn.setEnabled(False)
        self.open_folder_btn.setToolTip(self._i18n.tr("show_in_folder_tooltip"))
        self.open_folder_btn.clicked.connect(self._reveal_last_output)
        actions.addWidget(self.browse_btn)
        actions.addWidget(self.clear_btn)
        actions.addWidget(self.open_output_btn)
        actions.addWidget(self.open_folder_btn)
        actions.addStretch()
        actions.addWidget(self.process_btn)
        input_card.addLayout(actions)

        layout.addWidget(input_card)

        # ----- Console card -----
        console_card = Card(self._i18n.tr("console_card_title"))
        console_actions = QHBoxLayout()
        console_actions.setSpacing(8)
        self.console_status = QLabel(self._i18n.tr("awaiting_input"))
        self.console_status.setObjectName("hint")
        console_actions.addWidget(self.console_status, stretch=1)
        self.clear_console_btn = QPushButton(self._i18n.tr("clear_log"))
        self.clear_console_btn.setObjectName("ghostBtn")
        self.clear_console_btn.clicked.connect(lambda: self.console.clear())
        console_actions.addWidget(self.clear_console_btn)
        console_card.addLayout(console_actions)

        # Progress bar for large file processing
        self.progress_bar = QProgressBar()
        self.progress_bar.setObjectName("progressBar")
        self.progress_bar.setVisible(False)
        self.progress_bar.setMinimum(0)
        self.progress_bar.setMaximum(100)
        self.progress_bar.setTextVisible(True)
        self.progress_bar.setFormat("%p%")
        console_card.addWidget(self.progress_bar)

        self.console = QTextEdit()
        self.console.setReadOnly(True)
        self.console.setObjectName("liveConsole")
        self.console.setMinimumHeight(220)
        console_card.addWidget(self.console)
        layout.addWidget(console_card, stretch=1)

    # ----- file selection -------------------------------------------------

    def _refresh_recent_files(self) -> None:
        """Refresh the recent files list from disk."""
        recent_files = db.get_recent_files()

        # Clear existing buttons
        for i in reversed(range(self.recent_files_container.count())):
            widget = self.recent_files_container.itemAt(i).widget()
            if widget:
                widget.deleteLater()

        # Add new buttons
        for file_path in recent_files:
            btn = QPushButton(os.path.basename(file_path))
            btn.setObjectName("ghostBtn")
            btn.setToolTip(file_path)
            btn.clicked.connect(lambda _, p=file_path: self._on_file_selected(p))
            self.recent_files_container.addWidget(btn)

        # Show/hide label based on whether there are recent files
        has_recent = len(recent_files) > 0
        self.recent_files_label.setVisible(has_recent)

    def _on_file_selected(self, path: str) -> None:
        self.selected_file = path
        name = os.path.basename(path)
        self.file_label.setText(name)
        self.file_label.setToolTip(path)
        self.process_btn.setEnabled(True)
        self.clear_btn.setEnabled(True)
        self.status_pill.set_state("idle", self._i18n.tr("ready"))
        self.console_status.setText(f"{self._i18n.tr('loaded_prefix')} {name}")
        self.log(f"📄  Loaded {name}\n")

        # Add to recent files
        db.add_recent_file(path)
        self._refresh_recent_files()

    def browse_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, self._i18n.tr("file_dialog_title"), "", self._i18n.tr("file_dialog_filter")
        )
        if path:
            self._on_file_selected(path)

    def _clear_selection(self) -> None:
        self.selected_file = None
        self.file_label.setText(self._i18n.tr("no_file_selected"))
        self.file_label.setToolTip("")
        self.process_btn.setEnabled(False)
        self.clear_btn.setEnabled(False)
        self.status_pill.set_state("idle", self._i18n.tr("idle"))
        self.console_status.setText(self._i18n.tr("awaiting_input"))
        self.progress_bar.setVisible(False)

    # ----- console helpers ------------------------------------------------

    def keyPressEvent(self, event) -> None:
        """Handle keyboard shortcuts."""
        if event.key() == Qt.Key_Escape:
            self._clear_selection()
            event.accept()
        elif event.modifiers() == Qt.ControlModifier:
            if event.key() == Qt.Key_O:
                self.browse_file()
                event.accept()
            elif event.key() == Qt.Key_P:
                if self.process_btn.isEnabled():
                    self.start_processing()
                event.accept()
            elif event.key() == Qt.Key_S:
                # Save settings shortcut
                event.ignore()  # Let it propagate to main window
            elif event.key() == Qt.Key_L:
                self.console.clear()
                event.accept()
        else:
            super().keyPressEvent(event)

    def log(self, text: str) -> None:
        self.console.insertPlainText(text)
        sb = self.console.verticalScrollBar()
        sb.setValue(sb.maximum())

    def set_progress(self, value: int, max_value: int = 100, visible: bool = True) -> None:
        """Set the progress bar value and visibility."""
        self.progress_bar.setVisible(visible)
        if max_value > 0:
            self.progress_bar.setMaximum(max_value)
        self.progress_bar.setValue(value)

    def reset_progress(self) -> None:
        """Reset and hide the progress bar."""
        self.progress_bar.setValue(0)
        self.progress_bar.setVisible(False)

    def _show_toast(self, message: str, duration: int = 3000) -> None:
        """Show a toast notification from the main window."""
        # Get the main window and show toast
        from PySide6.QtWidgets import QApplication

        from gui.main_window import MainWindow

        for widget in QApplication.topLevelWidgets():
            if isinstance(widget, MainWindow):
                widget.show_toast(message, duration)
                break

    # ----- processing -----------------------------------------------------

    def start_processing(self) -> None:
        if not self.selected_file:
            return

        settings = db.get_settings()
        if not settings or not settings.get("api_key"):
            QMessageBox.warning(
                self,
                self._i18n.tr("settings_required_title"),
                self._i18n.tr("settings_required_message"),
            )
            return

        self.process_btn.setEnabled(False)
        self.browse_btn.setEnabled(False)
        self.clear_btn.setEnabled(False)
        self.console.clear()
        self.status_pill.set_state("running", self._i18n.tr("processing"))
        self.console_status.setText(self._i18n.tr("streaming_ai"))
        self.log("Initializing processor…\n")
        self.set_progress(0, 100, True)

        # Disconnect any previous signal handlers so the page can be reused.
        self.signals = WorkerSignals()
        self.signals.log.connect(self.log)
        self.signals.finished.connect(self.on_processing_finished)
        self.signals.error.connect(self.on_processing_error)

        processor = BOQProcessor(self.selected_file, self.signals, self._i18n)

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        # add_done_callback is a safety net: if the task raises an
        # exception that the Worker's own try/except doesn't catch
        # (e.g. an asyncio.CancelledError leak, a bug in the qasync
        # bridge), we still want the page to leave the "Processing…"
        # state instead of staying stuck.
        task = loop.create_task(processor.process())
        task.add_done_callback(self._on_processor_done)

    def _on_processor_done(self, task) -> None:
        """Safety net for the BOQProcessor task.

        Called when the asyncio task finishes (success, failure, or
        cancellation). The normal paths route through
        ``signals.finished`` or ``signals.error``; this handler
        covers any exception that escapes those — without it, a
        single leaked exception would leave the page stuck on
        "Processing…" forever.
        """
        if task.cancelled():
            log.warning("BOQProcessor task was cancelled")
            return
        exc = task.exception()
        if exc is not None:
            log.exception("BOQProcessor task raised unhandled exception")
            # Re-use the same error path the Worker uses so the UI
            # state stays consistent (status pill, log, etc.).
            self.on_processing_error(f"{type(exc).__name__}: {exc}")

    def on_processing_finished(self, output_path: str) -> None:
        self.log(
            f"\n\n🎉 {self._i18n.tr('processing_complete')}\n{self._i18n.tr('output_saved_to').format(path=output_path)}\n"
        )
        self.process_btn.setEnabled(True)
        self.browse_btn.setEnabled(True)
        self.clear_btn.setEnabled(True)
        self.status_pill.set_state("success", self._i18n.tr("done"))
        self.console_status.setText(
            f"{self._i18n.tr('saved_prefix')} {os.path.basename(output_path)}"
        )
        self.reset_progress()
        # Stash the path so the "Open Output" button can find it.
        self._last_output_path = output_path
        self.open_output_btn.setEnabled(True)
        self.open_folder_btn.setEnabled(True)

        # Show toast notification
        self._show_toast(self._i18n.tr("processing_complete"))

        # Confirmation dialog with two actions: open the file, or
        # reveal it in Explorer. Both are common next steps and
        # make the success state actually actionable.
        from PySide6.QtWidgets import QMessageBox

        box = QMessageBox(self)
        box.setIcon(QMessageBox.Information)
        box.setWindowTitle(self._i18n.tr("complete"))
        box.setText(self._i18n.tr("successfully_generated"))
        box.setInformativeText(f"{self._i18n.tr('saved_to').format(path=output_path)}")
        open_btn = box.addButton(self._i18n.tr("open_excel"), QMessageBox.AcceptRole)
        reveal_btn = box.addButton(self._i18n.tr("show_in_folder"), QMessageBox.ActionRole)
        box.addButton(QMessageBox.Close)
        box.setDefaultButton(open_btn)
        box.exec()
        clicked = box.clickedButton()
        if clicked is open_btn:
            self._open_output_file(output_path)
        elif clicked is reveal_btn:
            self._reveal_in_folder(output_path)

    def on_processing_error(self, error_msg: str) -> None:
        self.log(f"\n\n❌ {self._i18n.tr('error_during_processing')}\n{error_msg}\n")
        self.process_btn.setEnabled(True)
        self.browse_btn.setEnabled(True)
        self.clear_btn.setEnabled(True)
        self.status_pill.set_state("error", self._i18n.tr("error"))
        self.console_status.setText(f"{self._i18n.tr('error_prefix')} {error_msg[:80]}")
        self.reset_progress()
        self.open_output_btn.setEnabled(False)
        self.open_folder_btn.setEnabled(False)
        QMessageBox.critical(
            self, self._i18n.tr("error"), f"{self._i18n.tr('failed_to_process')}\n{error_msg}"
        )

    # ----- output helpers ------------------------------------------------

    def _open_output_file(self, path: str) -> None:
        """Open the generated Excel in the OS default viewer."""
        if not path or not os.path.exists(path):
            QMessageBox.warning(
                self,
                self._i18n.tr("file_missing"),
                f"{self._i18n.tr('output_file_missing')}\n{path}",
            )
            return
        try:
            if sys.platform == "win32":
                os.startfile(path)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as e:
            QMessageBox.critical(
                self, self._i18n.tr("open_failed"), f"{self._i18n.tr('could_not_open_file')}\n{e}"
            )

    def _reveal_in_folder(self, path: str) -> None:
        """Open the containing folder in Explorer / Finder / file manager,
        with the file selected if the OS supports it."""
        if not path or not os.path.exists(path):
            QMessageBox.warning(
                self,
                self._i18n.tr("file_missing"),
                f"{self._i18n.tr('output_file_missing')}\n{path}",
            )
            return
        try:
            if sys.platform == "win32":
                # /select, highlights the file in a new Explorer window.
                subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
            elif sys.platform == "darwin":
                subprocess.Popen(["open", "-R", path])
            else:
                subprocess.Popen(["xdg-open", os.path.dirname(path)])
        except Exception as e:
            QMessageBox.critical(
                self,
                self._i18n.tr("reveal_failed"),
                f"{self._i18n.tr('could_not_open_folder')}\n{e}",
            )

    def _open_last_output(self) -> None:
        """Slot for the in-page "Open Output" button."""
        if self._last_output_path:
            self._open_output_file(self._last_output_path)

    def _reveal_last_output(self) -> None:
        """Slot for the in-page "Show in Folder" button."""
        if self._last_output_path:
            self._reveal_in_folder(self._last_output_path)

    # ----- i18n -----------------------------------------------------------

    def retranslate_ui(self) -> None:
        """Re-apply translated labels to the visible widgets.

        Called by MainWindow whenever the i18n object emits
        ``language_changed``. The status pill and the console
        status line are intentionally left as-is here — they
        show transient state (e.g. "Processing…", "Saved: foo.xlsx")
        which the next event will overwrite with the translated
        string anyway.
        """
        self.browse_btn.setText(self._i18n.tr("select_file"))
        self.process_btn.setText(
            self._i18n.tr("process_button_prefix") + self._i18n.tr("process_button")
        )
        self.clear_btn.setText(self._i18n.tr("clear"))
        self.open_output_btn.setText(self._i18n.tr("open_output"))
        self.open_folder_btn.setText(self._i18n.tr("show_in_folder"))
        self.clear_console_btn.setText(self._i18n.tr("clear_log"))
        self.console_status.setText(self._i18n.tr("awaiting_input"))
        # Update file label if no file is selected
        if not self.selected_file:
            self.file_label.setText(self._i18n.tr("no_file_selected"))
