"""State-driven Tawreed Workbench.

The page deliberately never renders BOQ rows, spreadsheet previews, model
output, or raw paths.  The processor exposes an opaque approval token and a
count-only summary.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

from PySide6.QtCore import QEasingCurve, QPropertyAnimation, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QAccessible, QAccessibleEvent, QDragEnterEvent, QDropEvent
from PySide6.QtWidgets import (
    QApplication,
    QBoxLayout,
    QFileDialog,
    QFrame,
    QGraphicsOpacityEffect,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStackedWidget,
    QStyle,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from core.i18n import I18n, get_i18n
from core.run_contracts import ApprovalRequest, RunPhase, RunProgress
from gui.design_tokens import Layout, Spacing
from gui.styles import motion_enabled
from gui.worker import BOQProcessor, WorkerSignals


class DropZone(QPushButton):
    """Keyboard-operable .xlsx picker that also accepts file drops."""

    file_dropped = Signal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("pageHost")
        self.setObjectName("dropZone")
        self.setAcceptDrops(True)
        self.setFixedHeight(Layout.WORKBENCH_DROP_HEIGHT)
        self.setIcon(QApplication.style().standardIcon(QStyle.SP_FileIcon))
        self.setIconSize(QSize(34, 34))
        self.setCursor(Qt.PointingHandCursor)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

    @staticmethod
    def _xlsx_from_event(event: QDragEnterEvent | QDropEvent) -> str | None:
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if path and Path(path).is_file() and Path(path).suffix.casefold() == ".xlsx":
                return path
        return None

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if self._xlsx_from_event(event):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event: QDropEvent) -> None:
        path = self._xlsx_from_event(event)
        if path:
            self.file_dropped.emit(path)
            event.acceptProposedAction()
        else:
            event.ignore()


class PhaseStrip(QWidget):
    PHASES = (
        RunPhase.INSPECTING,
        RunPhase.STRUCTURING,
        RunPhase.CLASSIFYING,
        RunPhase.VALIDATING,
        RunPhase.APPROVAL,
    )

    def __init__(self, i18n: I18n, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._i18n = i18n
        self._nodes: dict[RunPhase, tuple[QLabel, QLabel]] = {}
        self._lines: list[QFrame] = []
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(8)
        for index, phase in enumerate(self.PHASES):
            column = QVBoxLayout()
            column.setAlignment(Qt.AlignCenter)
            dot = QLabel(str(index + 1), self)
            dot.setObjectName("phaseDot")
            dot.setAlignment(Qt.AlignCenter)
            dot.setFixedSize(40, 40)
            label = QLabel(self)
            label.setObjectName("phaseLabel")
            label.setAlignment(Qt.AlignCenter)
            column.addWidget(dot, 0, Qt.AlignCenter)
            column.addWidget(label)
            row.addLayout(column, 0)
            self._nodes[phase] = (dot, label)
            if index < len(self.PHASES) - 1:
                line = QFrame(self)
                line.setObjectName("phaseLine")
                line.setFixedHeight(1)
                row.addWidget(line, 1)
                self._lines.append(line)
        self.retranslate_ui()
        self.set_phase(RunPhase.INSPECTING)

    def retranslate_ui(self) -> None:
        for phase, (_dot, label) in self._nodes.items():
            label.setText(self._i18n.tr(f"phase_{phase.value}"))

    def set_phase(self, current: RunPhase) -> None:
        current_index = self.PHASES.index(current) if current in self.PHASES else -1
        for index, (_phase, (dot, label)) in enumerate(self._nodes.items()):
            state = (
                "complete"
                if index < current_index
                else "active"
                if index == current_index
                else "idle"
            )
            dot.setText("✓" if state == "complete" else str(index + 1))
            for widget in (dot, label):
                widget.setProperty("state", state)
                widget.style().unpolish(widget)
                widget.style().polish(widget)
        for index, line in enumerate(self._lines):
            state = "complete" if index < current_index else "idle"
            line.setProperty("state", state)
            line.style().unpolish(line)
            line.style().polish(line)


class WorkspacePage(QWidget):
    """One run, rendered as an explicit state machine."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._i18n = get_i18n()
        self.selected_file: str | None = None
        self._output_path: str | None = None
        self._processor: BOQProcessor | None = None
        self._signals: WorkerSignals | None = None
        self._task: asyncio.Task | None = None
        self._approval: ApprovalRequest | None = None
        self._run_started = 0.0
        self._last_progress: RunProgress | None = None
        self._state_animation: QPropertyAnimation | None = None
        self._build_ui()
        self._elapsed_timer = QTimer(self)
        self._elapsed_timer.setInterval(1000)
        self._elapsed_timer.timeout.connect(self._update_elapsed)
        self._show_state(RunPhase.EMPTY)

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
        outer_canvas_layout = QVBoxLayout(canvas)
        outer_canvas_layout.setContentsMargins(
            Layout.PAGE_GUTTER, Layout.PAGE_TOP, Layout.PAGE_GUTTER, Layout.PAGE_GUTTER
        )
        outer_canvas_layout.setSpacing(0)
        scroll.setWidget(canvas)

        self.content = QWidget(canvas)
        self.content.setObjectName("contentColumn")
        self.content.setMaximumWidth(Layout.CONTENT_MAX)
        self.content.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.canvas_layout = QVBoxLayout(self.content)
        self.canvas_layout.setContentsMargins(0, 0, 0, 0)
        self.canvas_layout.setSpacing(Spacing.LG)
        outer_canvas_layout.addWidget(self.content, 1, Qt.AlignLeft)

        self.title = QLabel(self.content)
        self.title.setObjectName("pageTitle")
        self.subtitle = QLabel(self.content)
        self.subtitle.setObjectName("pageSubtitle")
        self.subtitle.setWordWrap(True)
        self.canvas_layout.addWidget(self.title)
        self.canvas_layout.addWidget(self.subtitle)

        self.stack = QStackedWidget(self.content)
        self.stack.setObjectName("workbenchStack")
        self.empty_view = self._build_empty_view()
        self.ready_view = self._build_ready_view()
        self.processing_view = self._build_processing_view()
        self.approval_view = self._build_approval_view()
        self.complete_view = self._build_complete_view()
        self.error_view = self._build_error_view()
        for view in (
            self.empty_view,
            self.ready_view,
            self.processing_view,
            self.approval_view,
            self.complete_view,
            self.error_view,
        ):
            self.stack.addWidget(view)
        self.canvas_layout.addWidget(self.stack, 1)
        self.retranslate_ui()

    def _view(self) -> tuple[QWidget, QVBoxLayout]:
        widget = QWidget(self)
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(0, Spacing.SM, 0, 0)
        layout.setSpacing(Spacing.MD)
        return widget, layout

    def _build_empty_view(self) -> QWidget:
        view, layout = self._view()
        layout.setContentsMargins(0, Spacing.XL, 0, 0)
        self.drop_zone = DropZone(view)
        self.drop_zone.setMaximumWidth(Layout.WORKBENCH_DROP_WIDTH)
        self.drop_zone.clicked.connect(self._browse_file)
        self.drop_zone.file_dropped.connect(self.select_file)
        layout.addWidget(self.drop_zone, 0, Qt.AlignLeft)
        self.empty_hint = QLabel(view)
        self.empty_hint.setObjectName("hintText")
        self.empty_hint.setAlignment(Qt.AlignLeft)
        self.empty_hint.setMaximumWidth(Layout.WORKBENCH_DROP_WIDTH)
        layout.addWidget(self.empty_hint, 0, Qt.AlignLeft)
        layout.addStretch(1)
        return view

    def _build_ready_view(self) -> QWidget:
        view, layout = self._view()
        panel = QFrame(view)
        panel.setObjectName("filePanel")
        row = QHBoxLayout(panel)
        row.setContentsMargins(22, 20, 22, 20)
        text = QVBoxLayout()
        self.ready_label = QLabel(panel)
        self.ready_label.setObjectName("sectionTitle")
        self.file_name_label = QLabel(panel)
        self.file_name_label.setObjectName("fileName")
        self.file_name_label.setWordWrap(True)
        text.addWidget(self.ready_label)
        text.addWidget(self.file_name_label)
        row.addLayout(text, 1)
        self.replace_button = QPushButton(panel)
        self.replace_button.setObjectName("secondaryButton")
        self.replace_button.clicked.connect(self._browse_file)
        row.addWidget(self.replace_button)
        layout.addWidget(panel)
        self.start_button = QPushButton(view)
        self.start_button.setObjectName("primaryButton")
        self.start_button.setMinimumHeight(46)
        self.start_button.clicked.connect(self.start_processing)
        layout.addWidget(self.start_button, 0, Qt.AlignRight)
        layout.addStretch(1)
        return view

    def _build_processing_view(self) -> QWidget:
        view, layout = self._view()
        self.phase_strip = PhaseStrip(self._i18n, view)
        layout.addWidget(self.phase_strip)
        layout.addSpacing(18)
        self.status_label = QLabel(view)
        self.status_label.setObjectName("runStatus")
        self.status_label.setWordWrap(True)
        self.status_label.setAccessibleName("Run status")
        layout.addWidget(self.status_label)
        self.progress_bar = QProgressBar(view)
        self.progress_bar.setObjectName("runProgress")
        self.progress_bar.setTextVisible(False)
        layout.addWidget(self.progress_bar)
        meta = QHBoxLayout()
        self.progress_count = QLabel(view)
        self.progress_count.setObjectName("hintText")
        self.elapsed_label = QLabel(view)
        self.elapsed_label.setObjectName("hintText")
        meta.addWidget(self.progress_count)
        meta.addStretch(1)
        meta.addWidget(self.elapsed_label)
        layout.addLayout(meta)
        self.cancel_button = QPushButton(view)
        self.cancel_button.setObjectName("secondaryButton")
        self.cancel_button.clicked.connect(self.cancel_run)
        layout.addWidget(self.cancel_button, 0, Qt.AlignRight)
        layout.addStretch(1)
        return view

    def _build_approval_view(self) -> QWidget:
        view, layout = self._view()
        self.approval_layout = QBoxLayout(QBoxLayout.LeftToRight)
        self.approval_layout.setSpacing(34)
        left = QWidget(view)
        left_col = QVBoxLayout(left)
        left_col.setContentsMargins(0, 0, 0, 0)
        self.approval_heading = QLabel(left)
        self.approval_heading.setObjectName("runHeading")
        self.approval_text = QLabel(left)
        self.approval_text.setObjectName("pageSubtitle")
        self.approval_text.setWordWrap(True)
        self.approval_phase_strip = PhaseStrip(self._i18n, left)
        self.approval_phase_strip.set_phase(RunPhase.APPROVAL)
        left_col.addWidget(self.approval_heading)
        left_col.addWidget(self.approval_text)
        left_col.addSpacing(18)
        left_col.addWidget(self.approval_phase_strip)
        left_col.addStretch(1)
        self.details_toggle = QToolButton(left)
        self.details_toggle.setObjectName("disclosureButton")
        self.details_toggle.setCheckable(True)
        self.details_toggle.setArrowType(Qt.RightArrow)
        self.details_toggle.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        self.details_toggle.toggled.connect(self._toggle_details)
        left_col.addWidget(self.details_toggle)
        self.details_panel = QLabel(left)
        self.details_panel.setObjectName("diagnosticPanel")
        self.details_panel.setWordWrap(True)
        self.details_panel.hide()
        left_col.addWidget(self.details_panel)
        self.approval_layout.addWidget(left, 3)

        divider = QFrame(view)
        divider.setObjectName("summaryDivider")
        divider.setFrameShape(QFrame.VLine)
        self.approval_layout.addWidget(divider)

        summary = QFrame(view)
        summary.setObjectName("summaryPanel")
        summary.setMinimumWidth(440)
        summary.setMaximumWidth(470)
        summary_col = QVBoxLayout(summary)
        summary_col.setContentsMargins(40, 22, 28, 18)
        summary_col.setSpacing(13)
        self.total_caption = QLabel(summary)
        self.total_caption.setObjectName("summaryCaption")
        self.total_value = QLabel(summary)
        self.total_value.setObjectName("summaryTotal")
        self.items_suffix = QLabel(summary)
        self.items_suffix.setObjectName("summarySuffix")
        self.packages_caption = QLabel(summary)
        self.packages_caption.setObjectName("summaryCaption")
        self.package_list = QVBoxLayout()
        self.package_list.setSpacing(7)
        self.warning_label = QLabel(summary)
        self.warning_label.setObjectName("warningText")
        self.warning_label.setWordWrap(True)
        self.warning_heading = QLabel(summary)
        self.warning_heading.setObjectName("warningHeading")
        self.provider_caption = QLabel(summary)
        self.provider_caption.setObjectName("summaryCaption")
        self.provider_label = QLabel(summary)
        self.provider_label.setObjectName("summaryValue")
        self.model_caption = QLabel(summary)
        self.model_caption.setObjectName("summaryCaption")
        self.model_label = QLabel(summary)
        self.model_label.setObjectName("summaryValue")
        summary_col.addWidget(self.total_caption)
        total_row = QHBoxLayout()
        total_row.setSpacing(8)
        total_row.addWidget(self.total_value)
        total_row.addWidget(self.items_suffix, 0, Qt.AlignBottom)
        total_row.addStretch(1)
        summary_col.addLayout(total_row)
        summary_col.addSpacing(8)
        summary_col.addWidget(self.packages_caption)
        summary_col.addLayout(self.package_list)
        summary_col.addSpacing(6)
        summary_col.addWidget(self.warning_heading)
        summary_col.addWidget(self.warning_label)
        summary_col.addStretch(1)
        provider_row = QHBoxLayout()
        provider_row.addWidget(self.provider_caption)
        provider_row.addStretch(1)
        provider_row.addWidget(self.provider_label)
        model_row = QHBoxLayout()
        model_row.addWidget(self.model_caption)
        model_row.addStretch(1)
        model_row.addWidget(self.model_label)
        summary_col.addLayout(provider_row)
        summary_col.addLayout(model_row)
        actions = QHBoxLayout()
        self.approve_button = QPushButton(summary)
        self.approve_button.setObjectName("primaryButton")
        self.approve_button.clicked.connect(self.approve_and_generate)
        self.approval_cancel_button = QPushButton(summary)
        self.approval_cancel_button.setObjectName("secondaryButton")
        self.approval_cancel_button.clicked.connect(self.cancel_run)
        actions.addWidget(self.approve_button, 2)
        actions.addWidget(self.approval_cancel_button, 1)
        summary_col.addLayout(actions)
        self.approval_layout.addWidget(summary, 2)
        layout.addLayout(self.approval_layout)
        return view

    def _build_complete_view(self) -> QWidget:
        view, layout = self._view()
        self.complete_mark = QLabel("✓", view)
        self.complete_mark.setObjectName("completeMark")
        self.complete_mark.setAlignment(Qt.AlignCenter)
        self.complete_heading = QLabel(view)
        self.complete_heading.setObjectName("runHeading")
        self.complete_heading.setAlignment(Qt.AlignCenter)
        self.complete_file = QLabel(view)
        self.complete_file.setObjectName("fileName")
        self.complete_file.setAlignment(Qt.AlignCenter)
        self.complete_file.setWordWrap(True)
        layout.addStretch(1)
        layout.addWidget(self.complete_mark)
        layout.addWidget(self.complete_heading)
        layout.addWidget(self.complete_file)
        actions = QHBoxLayout()
        self.open_excel_button = QPushButton(view)
        self.open_excel_button.setObjectName("primaryButton")
        self.open_excel_button.clicked.connect(self._open_output)
        self.show_folder_button = QPushButton(view)
        self.show_folder_button.setObjectName("secondaryButton")
        self.show_folder_button.clicked.connect(self._show_output_folder)
        self.another_button = QPushButton(view)
        self.another_button.setObjectName("secondaryButton")
        self.another_button.clicked.connect(self.reset)
        actions.addWidget(self.open_excel_button)
        actions.addWidget(self.show_folder_button)
        actions.addWidget(self.another_button)
        layout.addLayout(actions)
        layout.addStretch(2)
        return view

    def _build_error_view(self) -> QWidget:
        view, layout = self._view()
        self.error_heading = QLabel(view)
        self.error_heading.setObjectName("runHeading")
        self.error_message = QLabel(view)
        self.error_message.setObjectName("errorText")
        self.error_message.setWordWrap(True)
        self.retry_button = QPushButton(view)
        self.retry_button.setObjectName("primaryButton")
        self.retry_button.clicked.connect(self.start_processing)
        self.error_reset_button = QPushButton(view)
        self.error_reset_button.setObjectName("secondaryButton")
        self.error_reset_button.clicked.connect(self.reset)
        layout.addWidget(self.error_heading)
        layout.addWidget(self.error_message)
        actions = QHBoxLayout()
        actions.addWidget(self.retry_button)
        actions.addWidget(self.error_reset_button)
        actions.addStretch(1)
        layout.addLayout(actions)
        layout.addStretch(1)
        return view

    def _browse_file(self) -> None:
        path, _filter = QFileDialog.getOpenFileName(
            self, self._i18n.tr("select_boq_title"), "", "Excel workbooks (*.xlsx)"
        )
        if path:
            self.select_file(path)

    def select_file(self, path: str) -> None:
        file_path = Path(path)
        if not file_path.is_file() or file_path.suffix.casefold() != ".xlsx":
            self._show_error(self._i18n.tr("xlsx_only_error"))
            return
        self.selected_file = str(file_path)
        self.file_name_label.setText(file_path.name)
        self._show_state(RunPhase.READY)

    def start_processing(self) -> None:
        if not self.selected_file:
            self._show_state(RunPhase.EMPTY)
            return
        self._approval = None
        self._output_path = None
        self._signals = WorkerSignals()
        self._signals.progress.connect(self._on_progress)
        self._signals.review_ready.connect(self._on_approval_ready)
        self._signals.finished.connect(self._on_finished)
        self._signals.error.connect(self._show_error)
        self._processor = BOQProcessor(self.selected_file, self._signals, self._i18n)
        self._run_started = time.monotonic()
        self._elapsed_timer.start()
        self._show_state(RunPhase.INSPECTING)
        self._task = asyncio.ensure_future(self._processor.process())

    def _on_progress(self, progress: RunProgress) -> None:
        self._last_progress = progress
        self.status_label.setText(progress.message)
        self.cancel_button.setEnabled(progress.cancellable)
        if progress.phase in PhaseStrip.PHASES:
            self.phase_strip.set_phase(progress.phase)
        if progress.current is not None and progress.total:
            self.progress_bar.setRange(0, progress.total)
            self.progress_bar.setValue(progress.current)
            self.progress_count.setText(f"{progress.current} / {progress.total}")
        else:
            self.progress_bar.setRange(0, 0)
            self.progress_count.clear()
        if progress.phase is RunPhase.EXPORTING:
            self._show_state(RunPhase.EXPORTING)
        self._announce(progress.message)

    def _on_approval_ready(self, request: ApprovalRequest) -> None:
        self._approval = request
        summary = request.summary
        self.total_value.setText(str(summary.total_items))
        while self.package_list.count():
            item = self.package_list.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        for name, count in summary.package_counts:
            row_widget = QWidget(self.approval_view)
            row = QHBoxLayout(row_widget)
            row.setContentsMargins(0, 0, 0, 0)
            name_label = QLabel(name, row_widget)
            count_label = QLabel(str(count), row_widget)
            count_label.setObjectName("packageCount")
            row.addWidget(name_label, 1)
            row.addWidget(count_label)
            self.package_list.addWidget(row_widget)
        has_warnings = bool(summary.warnings)
        self.warning_heading.setVisible(has_warnings)
        self.warning_label.setVisible(has_warnings)
        self.warning_label.setText("\n".join(summary.warnings))
        self.provider_label.setText(summary.provider)
        self.model_label.setText(summary.model)
        self.details_panel.setText(
            f"{summary.source_filename}\n{summary.provider} · {summary.model}\n"
            f"{self._format_elapsed(time.monotonic() - self._run_started)}"
        )
        self._elapsed_timer.stop()
        self._show_state(RunPhase.APPROVAL)
        self.approve_button.setFocus(Qt.OtherFocusReason)
        self._announce(self._i18n.tr("approval_ready_announcement"))

    def approve_and_generate(self) -> None:
        if not self._processor or not self._approval:
            return
        self.approve_button.setEnabled(False)
        self._elapsed_timer.start()
        self._show_state(RunPhase.EXPORTING)
        self._task = asyncio.ensure_future(self._processor.approve_and_export(self._approval.token))

    def cancel_run(self) -> None:
        if self._processor:
            self._processor.cancel()
        if self._task and not self._task.done():
            self._task.cancel()
        self.reset(keep_file=True)

    def _on_finished(self, output_path: str) -> None:
        self._elapsed_timer.stop()
        self._output_path = output_path
        self.complete_file.setText(Path(output_path).name)
        self._show_state(RunPhase.COMPLETE)
        self._announce(self._i18n.tr("run_complete_announcement"))

    def _show_error(self, message: str) -> None:
        self._elapsed_timer.stop()
        self.error_message.setText(message)
        self._show_state(RunPhase.ERROR)
        self._announce(message)

    def _show_state(self, phase: RunPhase) -> None:
        target = {
            RunPhase.EMPTY: self.empty_view,
            RunPhase.READY: self.ready_view,
            RunPhase.INSPECTING: self.processing_view,
            RunPhase.STRUCTURING: self.processing_view,
            RunPhase.CLASSIFYING: self.processing_view,
            RunPhase.VALIDATING: self.processing_view,
            RunPhase.EXPORTING: self.processing_view,
            RunPhase.APPROVAL: self.approval_view,
            RunPhase.COMPLETE: self.complete_view,
            RunPhase.ERROR: self.error_view,
        }[phase]
        self.stack.setCurrentWidget(target)
        approval_state = phase is RunPhase.APPROVAL
        self.title.setVisible(not approval_state)
        self.subtitle.setVisible(not approval_state)
        if motion_enabled() and self.isVisible():
            effect = QGraphicsOpacityEffect(target)
            target.setGraphicsEffect(effect)
            animation = QPropertyAnimation(effect, b"opacity", self)
            animation.setDuration(330 if phase is RunPhase.COMPLETE else 200)
            animation.setStartValue(0.0)
            animation.setEndValue(1.0)
            animation.setEasingCurve(QEasingCurve.OutCubic)
            animation.finished.connect(lambda widget=target: widget.setGraphicsEffect(None))
            self._state_animation = animation
            animation.start()
        if phase is RunPhase.EXPORTING:
            self.phase_strip.set_phase(RunPhase.APPROVAL)
            self.status_label.setText(self._i18n.tr("exporting_workbook"))
            self.progress_bar.setRange(0, 0)
            self.cancel_button.setEnabled(False)

    def reset(self, _checked: bool = False, *, keep_file: bool = False) -> None:
        self._elapsed_timer.stop()
        self._approval = None
        self._processor = None
        self._signals = None
        self._task = None
        self._last_progress = None
        self._output_path = None
        self.approve_button.setEnabled(True)
        self.details_toggle.setChecked(False)
        if not keep_file:
            self.selected_file = None
        self._show_state(RunPhase.READY if self.selected_file else RunPhase.EMPTY)

    def _toggle_details(self, checked: bool) -> None:
        self.details_toggle.setArrowType(Qt.DownArrow if checked else Qt.RightArrow)
        self.details_panel.setVisible(checked)

    def _update_elapsed(self) -> None:
        if self._run_started:
            self.elapsed_label.setText(self._format_elapsed(time.monotonic() - self._run_started))

    @staticmethod
    def _format_elapsed(seconds: float) -> str:
        total = max(0, int(seconds))
        minutes, seconds = divmod(total, 60)
        return f"{minutes:02d}:{seconds:02d}"

    def _announce(self, message: str) -> None:
        self.status_label.setAccessibleDescription(message)
        try:
            QAccessible.updateAccessibility(
                QAccessibleEvent(self.status_label, QAccessible.Event.NameChanged)
            )
        except Exception:
            pass

    def _open_output(self) -> None:
        if not self._output_path:
            return
        if sys.platform == "win32":
            os.startfile(self._output_path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", self._output_path])
        else:
            subprocess.Popen(["xdg-open", self._output_path])

    def _show_output_folder(self) -> None:
        if not self._output_path:
            return
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", os.path.normpath(self._output_path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", self._output_path])
        else:
            subprocess.Popen(["xdg-open", str(Path(self._output_path).parent)])

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        target_width = max(480, min(Layout.CONTENT_MAX, self.width() - 2 * Layout.PAGE_GUTTER))
        self.content.setFixedWidth(target_width)
        self.drop_zone.setFixedWidth(min(Layout.WORKBENCH_DROP_WIDTH, target_width))
        direction = QBoxLayout.TopToBottom if target_width < 980 else QBoxLayout.LeftToRight
        self.approval_layout.setDirection(direction)

    def retranslate_ui(self) -> None:
        self.title.setText(self._i18n.tr("workbench_title"))
        self.subtitle.setText(self._i18n.tr("workbench_subtitle"))
        self.drop_zone.setText(self._i18n.tr("drop_zone_action"))
        self.drop_zone.setAccessibleName(self._i18n.tr("drop_zone_accessible"))
        self.empty_hint.setText(self._i18n.tr("xlsx_only_hint"))
        self.ready_label.setText(self._i18n.tr("ready_to_run"))
        self.replace_button.setText(self._i18n.tr("replace_file"))
        self.start_button.setText(self._i18n.tr("start_agent"))
        self.cancel_button.setText(self._i18n.tr("cancel"))
        self.approval_heading.setText(self._i18n.tr("approval_title"))
        self.approval_text.setText(self._i18n.tr("approval_subtitle"))
        self.details_toggle.setText(self._i18n.tr("technical_details"))
        self.total_caption.setText(self._i18n.tr("total_items"))
        self.items_suffix.setText(self._i18n.tr("items_suffix"))
        self.packages_caption.setText(self._i18n.tr("work_packages"))
        self.warning_heading.setText(f"⚠  {self._i18n.tr('warnings_heading')}")
        self.provider_caption.setText(self._i18n.tr("provider_label"))
        self.model_caption.setText(self._i18n.tr("model_label"))
        approve_text = self._i18n.tr("approve_generate")
        self.approve_button.setText(approve_text.replace("&", "&&"))
        self.approve_button.setAccessibleName(approve_text)
        self.approval_cancel_button.setText(self._i18n.tr("cancel"))
        self.complete_heading.setText(self._i18n.tr("complete_title"))
        self.open_excel_button.setText(self._i18n.tr("open_excel"))
        self.show_folder_button.setText(self._i18n.tr("show_in_folder"))
        self.another_button.setText(self._i18n.tr("start_another"))
        self.error_heading.setText(self._i18n.tr("error_title"))
        self.retry_button.setText(self._i18n.tr("retry"))
        self.error_reset_button.setText(self._i18n.tr("choose_another_file"))
        if hasattr(self, "phase_strip"):
            self.phase_strip.retranslate_ui()
            self.approval_phase_strip.retranslate_ui()
