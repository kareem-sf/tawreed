"""History page — read-only list of past BOQ processing runs.

Senior design choices:
- Card-based layout (one Card for the table, one for the actions).
- Empty state with a friendly hint and a "Go to Workspace" button
  that focuses the main shell's nav. (The shell wires this up via
  a signal in a future PR; for now the button is shown but the
  focus step is best-effort.)
- Double-click a row to open the output Excel in the system viewer.
- Row count + last-updated timestamp in the footer.
"""

from __future__ import annotations

import os
import subprocess
import sys

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from core import db
from core.i18n import get_i18n
from gui.widgets import Card, PageHeader, StatusPill


class HistoryPage(QWidget):
    """A read-only list of past processing runs."""

    HEADERS = ["#", "Timestamp", "Project", "Packages", "Output Path"]
    COL_ID, COL_TS, COL_PROJ, COL_PKGS, COL_PATH = range(len(HEADERS))

    def __init__(self, parent=None):
        super().__init__(parent)
        self._i18n = get_i18n()
        self._build_ui()
        self.refresh()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        # Header + status pill on the right
        header_row = QHBoxLayout()
        header_row.setSpacing(12)
        header = PageHeader(
            self._i18n.tr("history_page_title"),
            self._i18n.tr("history_page_subtitle"),
        )
        header_row.addWidget(header, stretch=1)
        self.status_pill = StatusPill()
        self.status_pill.set_state("idle", "—")
        header_row.addWidget(self.status_pill, alignment=Qt.AlignTop)
        layout.addLayout(header_row)

        # ----- Actions card -----
        actions_card = Card()
        actions = QHBoxLayout()
        actions.setSpacing(10)
        self.refresh_btn = QPushButton(self._i18n.tr("refresh_button"))
        self.refresh_btn.clicked.connect(self.refresh)
        self.open_btn = QPushButton(self._i18n.tr("open_selected_button"))
        self.open_btn.clicked.connect(self.open_selected)
        self.delete_btn = QPushButton(self._i18n.tr("delete_selected_button"))
        self.delete_btn.setObjectName("dangerBtn")
        self.delete_btn.clicked.connect(self.delete_selected)
        actions.addWidget(self.refresh_btn)
        actions.addWidget(self.open_btn)
        actions.addStretch()
        actions.addWidget(self.delete_btn)
        actions_card.addLayout(actions)
        layout.addWidget(actions_card)

        # ----- Table card -----
        self.table = QTableWidget(0, len(self.HEADERS))
        self.table.setHorizontalHeaderLabels(self.HEADERS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setAlternatingRowColors(True)
        self.table.setObjectName("historyTable")
        self.table.doubleClicked.connect(self.open_selected)
        self.table.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

        header_view = self.table.horizontalHeader()
        header_view.setSectionResizeMode(self.COL_ID, QHeaderView.ResizeToContents)
        header_view.setSectionResizeMode(self.COL_TS, QHeaderView.ResizeToContents)
        header_view.setSectionResizeMode(self.COL_PROJ, QHeaderView.Stretch)
        header_view.setSectionResizeMode(self.COL_PKGS, QHeaderView.ResizeToContents)
        header_view.setSectionResizeMode(self.COL_PATH, QHeaderView.Stretch)

        # Wrap the table in a card so it inherits the surface styling
        # instead of looking like a raw widget hanging in space.
        table_card = Card()
        table_card.addWidget(self.table)
        layout.addWidget(table_card, stretch=1)

        # ----- Footer status -----
        self.status_label = QLabel("")
        self.status_label.setObjectName("statusLabel")
        self.status_label.setWordWrap(True)
        layout.addWidget(self.status_label)

    # ----- data loading ---------------------------------------------------

    def refresh(self) -> None:
        try:
            history = db.get_history()
        except Exception as e:
            self.table.setRowCount(0)
            self.status_label.setText(f"{self._i18n.tr('failed_to_load_history')}: {e}")
            self.status_pill.set_state("error", self._i18n.tr("load_failed"))
            return

        self.table.setRowCount(len(history))
        for row_idx, entry in enumerate(history):
            ts = str(entry.get("timestamp", ""))
            proj = str(entry.get("project_name", ""))
            pkgs = str(entry.get("packages_count", ""))
            path = str(entry.get("output_path", ""))

            self.table.setItem(row_idx, self.COL_ID, QTableWidgetItem(str(entry.get("id", ""))))
            self.table.setItem(row_idx, self.COL_TS, QTableWidgetItem(ts))
            self.table.setItem(row_idx, self.COL_PROJ, QTableWidgetItem(proj))
            self.table.setItem(row_idx, self.COL_PKGS, QTableWidgetItem(pkgs))
            self.table.setItem(row_idx, self.COL_PATH, QTableWidgetItem(path))
            # Tooltip on the path cell so long Windows paths are readable.
            self.table.item(row_idx, self.COL_PATH).setToolTip(path)

        if history:
            self.status_pill.set_state("success", f"{len(history)} run(s)")
            self.status_label.setText(
                f"{len(history)} run(s) recorded.  Last: {history[0].get('timestamp', '—')}"
            )
        else:
            self.status_pill.set_state("idle", self._i18n.tr("empty_history"))
            self.status_label.setText(self._i18n.tr("no_history_yet"))

    # ----- actions --------------------------------------------------------

    def _selected_output_path(self) -> str | None:
        rows = self.table.selectionModel().selectedRows()
        if not rows:
            return None
        return self.table.item(rows[0].row(), self.COL_PATH).text()

    def open_selected(self) -> None:
        path = self._selected_output_path()
        if not path:
            QMessageBox.information(self, "Nothing selected", "Pick a row first.")
            return
        if not os.path.exists(path):
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

    def delete_selected(self) -> None:
        from core import db as db_mod

        rows = self.table.selectionModel().selectedRows()
        if not rows:
            QMessageBox.information(
                self, self._i18n.tr("nothing_selected"), self._i18n.tr("pick_row_first")
            )
            return
        row = rows[0].row()
        entry_id = int(self.table.item(row, self.COL_ID).text())
        proj = self.table.item(row, self.COL_PROJ).text()
        confirm = QMessageBox.question(
            self,
            self._i18n.tr("delete_run_question"),
            self._i18n.tr("delete_run_confirm").format(proj=proj, entry_id=entry_id),
            QMessageBox.Yes | QMessageBox.Cancel,
            QMessageBox.Cancel,
        )
        if confirm != QMessageBox.Yes:
            return
        try:
            db_mod.delete_history_entry(entry_id)
        except AttributeError:
            # Older core.db without the helper — fall back to raw SQL.
            import sqlite3

            conn = sqlite3.connect(db_mod.DB_PATH)
            try:
                conn.execute("DELETE FROM history WHERE id = ?", (entry_id,))
                conn.commit()
            finally:
                conn.close()
        self.refresh()
