"""Compact, path-free run history."""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from typing import Any

from PySide6.QtCore import QAbstractListModel, QModelIndex, QSize, Qt
from PySide6.QtGui import QFont, QPainter, QPalette
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListView,
    QMenu,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStyle,
    QStyledItemDelegate,
    QStyleOptionViewItem,
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


class RunItemDelegate(QStyledItemDelegate):
    """Enterprise run row with stable columns and a compact narrow layout."""

    def sizeHint(self, option: QStyleOptionViewItem, index: QModelIndex) -> QSize:
        return QSize(option.rect.width(), 74)

    @staticmethod
    def _timestamp(value: str) -> str:
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").strftime("%b %d, %Y · %H:%M")
        except (TypeError, ValueError):
            return value

    def paint(self, painter: QPainter, option: QStyleOptionViewItem, index: QModelIndex) -> None:
        entry = index.data(RunListModel.EntryRole) or {}
        style = option.widget.style() if option.widget else QApplication.style()
        style.drawPrimitive(QStyle.PE_PanelItemViewItem, option, painter, option.widget)

        painter.save()
        rect = option.rect.adjusted(18, 0, -18, 0)
        text_color = option.palette.color(QPalette.Text)
        muted_color = option.palette.color(QPalette.PlaceholderText)
        accent_color = option.palette.color(QPalette.Highlight)
        name = str(entry.get("project_name") or "Tawreed run")
        packages = int(entry.get("packages_count") or 0)
        package_text = self._i18n.tr("run_packages_short").format(count=packages)
        status = self._i18n.tr("run_completed")
        timestamp = self._timestamp(str(entry.get("timestamp") or ""))

        name_font = QFont(option.font)
        name_font.setWeight(QFont.DemiBold)
        body_font = QFont(option.font)
        body_font.setPointSizeF(max(9.0, body_font.pointSizeF() - 0.25))
        metrics = painter.fontMetrics()

        if rect.width() >= 760:
            name_width = int(rect.width() * 0.36)
            status_x = rect.left() + name_width
            package_x = rect.left() + int(rect.width() * 0.58)
            date_x = rect.left() + int(rect.width() * 0.76)
            center_y = rect.center().y()

            painter.setFont(name_font)
            painter.setPen(text_color)
            painter.drawText(
                rect.left(),
                rect.top(),
                name_width - 22,
                rect.height(),
                Qt.AlignVCenter | Qt.AlignLeft,
                metrics.elidedText(name, Qt.ElideMiddle, name_width - 22),
            )
            painter.setBrush(accent_color)
            painter.setPen(Qt.NoPen)
            painter.drawEllipse(status_x, center_y - 4, 8, 8)
            painter.setFont(body_font)
            painter.setPen(text_color)
            painter.drawText(
                status_x + 16,
                rect.top(),
                package_x - status_x - 22,
                rect.height(),
                Qt.AlignVCenter | Qt.AlignLeft,
                status,
            )
            painter.setPen(muted_color)
            painter.drawText(
                package_x,
                rect.top(),
                date_x - package_x - 16,
                rect.height(),
                Qt.AlignVCenter | Qt.AlignLeft,
                package_text,
            )
            painter.drawText(
                date_x,
                rect.top(),
                rect.right() - date_x,
                rect.height(),
                Qt.AlignVCenter | Qt.AlignRight,
                timestamp,
            )
        else:
            painter.setFont(name_font)
            painter.setPen(text_color)
            painter.drawText(
                rect.left(),
                rect.top() + 11,
                rect.width(),
                25,
                Qt.AlignLeft | Qt.AlignVCenter,
                metrics.elidedText(name, Qt.ElideMiddle, rect.width()),
            )
            painter.setFont(body_font)
            painter.setPen(muted_color)
            painter.drawText(
                rect.left(),
                rect.top() + 38,
                rect.width(),
                22,
                Qt.AlignLeft | Qt.AlignVCenter,
                f"{status}  ·  {package_text}  ·  {timestamp}",
            )
        painter.restore()

    @property
    def _i18n(self):
        return get_i18n()


class HistoryPage(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("pageHost")
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
        canvas_layout = QVBoxLayout(canvas)
        canvas_layout.setContentsMargins(64, 46, 64, 46)
        scroll.setWidget(canvas)

        self.content = QWidget(canvas)
        self.content.setObjectName("runsContent")
        self.content.setMaximumWidth(1240)
        self.content.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        layout = QVBoxLayout(self.content)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(20)
        canvas_layout.addWidget(self.content, 1, Qt.AlignHCenter)

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
        self.list_view.setItemDelegate(RunItemDelegate(self.list_view))
        self.list_view.setUniformItemSizes(True)
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

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self.content.setFixedWidth(max(760, min(1240, self.width() - 128)))

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
