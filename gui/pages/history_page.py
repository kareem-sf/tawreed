"""Compact, path-free run history."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListView,
    QMenu,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from core import db
from core.i18n import get_i18n


class RunListModel(QAbstractListModel):
    EntryRole = Qt.UserRole + 1

    def __init__(self, entries: list[dict[str, Any]] | None = None, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("pageHost")
        self._i18n = get_i18n()
        self._entries = entries or []

    def set_entries(self, entries: list[dict[str, Any]]) -> None:
        self.beginResetModel()
        self._entries = list(entries)
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()) -> int:
        return 0 if parent.isValid() else len(self._entries)

    def data(self, index: QModelIndex, role=Qt.DisplayRole):
        if not index.isValid() or not 0 <= index.row() < len(self._entries):
            return None
        entry = self._entries[index.row()]
        if role == self.EntryRole:
            return entry
        if role == Qt.DisplayRole:
            name = str(entry.get("project_name") or "Tawreed run")
            packages = int(entry.get("packages_count") or 0)
            timestamp = str(entry.get("timestamp") or "")
            status = self._i18n.tr("run_completed")
            package_text = self._i18n.tr("run_packages_short").format(count=packages)
            return f"{name}\n{status}  ·  {package_text}  ·  {timestamp}"
        if role == Qt.AccessibleTextRole:
            return self.data(index, Qt.DisplayRole)
        return None

    def retranslate(self) -> None:
        if self._entries:
            self.dataChanged.emit(self.index(0, 0), self.index(len(self._entries) - 1, 0))


class HistoryPage(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._i18n = get_i18n()
        self._build_ui()
        self.refresh()

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
        layout = QVBoxLayout(canvas)
        layout.setContentsMargins(56, 42, 56, 42)
        layout.setSpacing(18)
        scroll.setWidget(canvas)

        header = QHBoxLayout()
        title_col = QVBoxLayout()
        self.title = QLabel(canvas)
        self.title.setObjectName("pageTitle")
        self.subtitle = QLabel(canvas)
        self.subtitle.setObjectName("pageSubtitle")
        self.subtitle.setWordWrap(True)
        title_col.addWidget(self.title)
        title_col.addWidget(self.subtitle)
        header.addLayout(title_col, 1)
        self.refresh_button = QPushButton(canvas)
        self.refresh_button.setObjectName("secondaryButton")
        self.refresh_button.clicked.connect(self.refresh)
        header.addWidget(self.refresh_button, 0, Qt.AlignTop)
        self.actions_button = QToolButton(canvas)
        self.actions_button.setObjectName("secondaryButton")
        self.actions_button.setPopupMode(QToolButton.InstantPopup)
        self.actions_button.setEnabled(False)
        self.actions_menu = QMenu(self.actions_button)
        self.open_action = self.actions_menu.addAction("")
        self.reveal_action = self.actions_menu.addAction("")
        self.actions_menu.addSeparator()
        self.remove_action = self.actions_menu.addAction("")
        self.open_action.triggered.connect(self.open_selected)
        self.reveal_action.triggered.connect(self.reveal_selected)
        self.remove_action.triggered.connect(self.remove_selected)
        self.actions_button.setMenu(self.actions_menu)
        header.addWidget(self.actions_button, 0, Qt.AlignTop)
        layout.addLayout(header)

        self.model = RunListModel(parent=self)
        self.list_view = QListView(canvas)
        self.list_view.setObjectName("runList")
        self.list_view.setModel(self.model)
        self.list_view.setSelectionMode(QAbstractItemView.SingleSelection)
        self.list_view.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.list_view.setSpacing(2)
        self.list_view.doubleClicked.connect(lambda _index: self.open_selected())
        self.list_view.selectionModel().selectionChanged.connect(self._selection_changed)
        layout.addWidget(self.list_view, 1)

        self.empty_label = QLabel(canvas)
        self.empty_label.setObjectName("emptyState")
        self.empty_label.setAlignment(Qt.AlignCenter)
        self.empty_label.setWordWrap(True)
        layout.addWidget(self.empty_label, 1)
        self.count_label = QLabel(canvas)
        self.count_label.setObjectName("hintText")
        layout.addWidget(self.count_label)
        self.retranslate_ui()

    def refresh(self) -> None:
        try:
            entries = db.get_history()
        except Exception as exc:
            entries = []
            self.empty_label.setText(f"{self._i18n.tr('failed_to_load_history')}: {exc}")
        self.model.set_entries(entries)
        self.list_view.setVisible(bool(entries))
        self.empty_label.setVisible(not entries)
        self.actions_button.setEnabled(False)
        self.count_label.setText(self._i18n.tr("run_count").format(count=len(entries)))

    def _selection_changed(self) -> None:
        self.actions_button.setEnabled(self.list_view.currentIndex().isValid())

    def _selected_entry(self) -> dict[str, Any] | None:
        index = self.list_view.currentIndex()
        return index.data(RunListModel.EntryRole) if index.isValid() else None

    def open_selected(self) -> None:
        entry = self._selected_entry()
        if entry:
            self._open_path(str(entry.get("output_path") or ""))

    def reveal_selected(self) -> None:
        entry = self._selected_entry()
        if not entry:
            return
        path = str(entry.get("output_path") or "")
        if not os.path.exists(path):
            QMessageBox.warning(
                self, self._i18n.tr("file_missing"), self._i18n.tr("output_file_missing")
            )
            return
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(path)])

    def _open_path(self, path: str) -> None:
        if not path or not os.path.exists(path):
            QMessageBox.warning(
                self, self._i18n.tr("file_missing"), self._i18n.tr("output_file_missing")
            )
            return
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])

    def remove_selected(self) -> None:
        entry = self._selected_entry()
        if not entry:
            return
        answer = QMessageBox.question(
            self,
            self._i18n.tr("remove_run_title"),
            self._i18n.tr("remove_run_message"),
            QMessageBox.Yes | QMessageBox.Cancel,
            QMessageBox.Cancel,
        )
        if answer == QMessageBox.Yes:
            db.delete_history_entry(int(entry["id"]))
            self.refresh()

    def retranslate_ui(self) -> None:
        self.title.setText(self._i18n.tr("runs_title"))
        self.subtitle.setText(self._i18n.tr("runs_subtitle"))
        self.refresh_button.setText(self._i18n.tr("refresh_button"))
        self.actions_button.setText(self._i18n.tr("actions"))
        self.open_action.setText(self._i18n.tr("open_excel"))
        self.reveal_action.setText(self._i18n.tr("show_in_folder"))
        self.remove_action.setText(self._i18n.tr("remove_from_history"))
        self.model.retranslate()
        if not self.model.rowCount():
            self.empty_label.setText(self._i18n.tr("runs_empty"))
