"""Mandatory human review dialog for proposed BOQ work packages."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

from core.packaging_agent import PackagingDraft


class ReviewDialog(QDialog):
    """Show every proposed assignment and return explicit user-approved edits."""

    PACKAGE_COLUMN = 5

    def __init__(self, draft: PackagingDraft, i18n=None, parent=None) -> None:
        super().__init__(parent)
        self.draft = draft
        self._i18n = i18n
        self._package_editors: dict[str, QComboBox] = {}
        self.setWindowTitle(self._tr("review_dialog_title", "Review work packages"))
        self.resize(1080, 680)
        self.setMinimumSize(820, 520)
        self._build_ui()
        self._refresh_summary()

    def _tr(self, key: str, fallback: str) -> str:
        return self._i18n.tr(key) if self._i18n else fallback

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(12)

        title = QLabel(self._tr("review_dialog_title", "Review work packages"))
        title.setObjectName("pageTitle")
        layout.addWidget(title)
        subtitle = QLabel(
            self._tr(
                "review_dialog_subtitle",
                "Check the AI proposal, edit any package, then approve the Excel export.",
            )
        )
        subtitle.setObjectName("hint")
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        project_line = QLabel(
            f"{self._tr('review_project_label', 'Project')}: {self.draft.project_name}   ·   "
            f"{self._tr('review_date_label', 'Date')}: {self.draft.date or '—'}"
        )
        project_line.setObjectName("hint")
        layout.addWidget(project_line)

        controls = QHBoxLayout()
        self.filter_input = QLineEdit()
        self.filter_input.setClearButtonEnabled(True)
        self.filter_input.setPlaceholderText(
            self._tr("review_filter_placeholder", "Search items or packages…")
        )
        self.filter_input.textChanged.connect(self._apply_filter)
        controls.addWidget(self.filter_input, stretch=1)
        self.summary_label = QLabel()
        self.summary_label.setObjectName("statusPill")
        controls.addWidget(self.summary_label)
        layout.addLayout(controls)

        self.table = QTableWidget(len(self.draft.items), 6)
        self.table.setObjectName("reviewTable")
        self.table.setHorizontalHeaderLabels(
            [
                self._tr("review_id_column", "ID"),
                self._tr("review_number_column", "No."),
                self._tr("review_description_column", "Description"),
                self._tr("review_unit_column", "Unit"),
                self._tr("review_quantity_column", "Qty"),
                self._tr("review_package_column", "Work Package"),
            ]
        )
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        header = self.table.horizontalHeader()
        header.setStretchLastSection(True)
        header.resizeSection(0, 70)
        header.resizeSection(1, 80)
        header.resizeSection(2, 390)
        header.resizeSection(3, 80)
        header.resizeSection(4, 90)

        package_names = list(self.draft.package_names)
        for row_index, item in enumerate(self.draft.items):
            values = [
                item.item_id,
                item.item_number,
                item.description,
                item.unit,
                str(item.quantity),
            ]
            for column, value in enumerate(values):
                table_item = QTableWidgetItem(value)
                if column in {0, 1, 3, 4}:
                    table_item.setTextAlignment(Qt.AlignCenter)
                self.table.setItem(row_index, column, table_item)

            editor = QComboBox()
            editor.setEditable(True)
            editor.addItems(package_names)
            editor.setCurrentText(item.suggested_package)
            editor.currentTextChanged.connect(self._refresh_summary)
            self.table.setCellWidget(row_index, self.PACKAGE_COLUMN, editor)
            self._package_editors[item.item_id] = editor

        layout.addWidget(self.table, stretch=1)

        footer = QHBoxLayout()
        self.restore_button = QPushButton(
            self._tr("review_restore_suggestions", "Restore AI suggestions")
        )
        self.restore_button.setObjectName("ghostBtn")
        self.restore_button.clicked.connect(self.restore_suggestions)
        footer.addWidget(self.restore_button)
        footer.addStretch(1)

        self.buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.export_button = self.buttons.addButton(
            self._tr("review_export_button", "Approve & Export"),
            QDialogButtonBox.AcceptRole,
        )
        self.export_button.setObjectName("primaryBtn")
        self.buttons.rejected.connect(self.reject)
        self.buttons.accepted.connect(self._accept_if_valid)
        footer.addWidget(self.buttons)
        layout.addLayout(footer)

    def reviewed_categories(self) -> dict[str, str]:
        return {
            item_id: " ".join(editor.currentText().split())
            for item_id, editor in self._package_editors.items()
        }

    def restore_suggestions(self) -> None:
        for item in self.draft.items:
            self._package_editors[item.item_id].setCurrentText(item.suggested_package)
        self._refresh_summary()

    def _refresh_summary(self, _text: str = "") -> None:
        categories = self.reviewed_categories()
        nonempty = [name for name in categories.values() if name]
        package_count = len(set(nonempty))
        self.summary_label.setText(
            self._tr("review_summary", "{items} items · {packages} packages").format(
                items=len(categories), packages=package_count
            )
        )
        self.export_button.setEnabled(len(nonempty) == len(categories))

    def _apply_filter(self, text: str) -> None:
        query = text.strip().casefold()
        categories = self.reviewed_categories()
        for row_index, item in enumerate(self.draft.items):
            haystack = " ".join(
                [
                    item.item_id,
                    item.item_number,
                    item.description,
                    item.unit,
                    categories[item.item_id],
                ]
            ).casefold()
            self.table.setRowHidden(row_index, bool(query and query not in haystack))

    def _accept_if_valid(self) -> None:
        categories = self.reviewed_categories()
        invalid = [item_id for item_id, package in categories.items() if not package]
        if invalid:
            QMessageBox.warning(
                self,
                self._tr("review_invalid_title", "Review incomplete"),
                self._tr(
                    "review_invalid_message",
                    "Every item needs a work package before export.",
                ),
            )
            return
        self.accept()
