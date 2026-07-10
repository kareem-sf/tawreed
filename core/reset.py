"""Wipe-everything reset for Tawreed.

Used by the Settings page "Reset everything" button. The reset:

1. Deletes ``config.json`` (provider, model, base_url, language).
2. Removes all api_key entries from the OS keyring (and the
   obfuscated fallback file, if no keyring is available).
3. Deletes the SQLite database (history table).
4. Removes the ``outputs/`` folder (cached Excel workbooks).
5. Removes ``ui_state.json`` (window geometry, last page).

The keyring wipe ensures a reset also removes secrets from the
operating-system credential store. Without it, the reset would
leave authentication material behind.

Window state is stored in a plain JSON file under ``~/.tawreed/``
instead of the Windows registry. Removing it makes the next launch
start with the default window size and Workbench page.

We are NOT removing the user's TAWREED_DIR itself so that re-launch
creates a fresh one with the same default shape. Removing the parent
would race with a parallel launch and is more destructive than the
user probably wants.

This module is import-time side-effect-free. The actual disk work
happens inside ``reset_all()``.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
from dataclasses import dataclass, field

from core import db


@dataclass
class ResetReport:
    """Summary of what was wiped, for the confirmation dialog."""

    config_deleted: bool = False
    api_keys_cleared: int = 0
    history_rows_deleted: int = 0
    outputs_deleted: int = 0
    ui_state_cleared: bool = False
    notes: list[str] = field(default_factory=list)

    def human_summary(self) -> str:
        lines = []
        if self.config_deleted:
            lines.append("• Provider, model, and base URL settings cleared.")
        if self.api_keys_cleared:
            lines.append(f"• {self.api_keys_cleared} API key(s) removed from the OS keyring.")
        if self.history_rows_deleted:
            lines.append(f"• {self.history_rows_deleted} history row(s) cleared.")
        if self.outputs_deleted:
            lines.append(f"• {self.outputs_deleted} output file(s) deleted.")
        if self.ui_state_cleared:
            lines.append("• Window size and last page cleared.")
        if not lines:
            lines.append("• Nothing to clear (already fresh).")
        lines.append("")
        lines.append("Tawreed will restart on the default settings next launch.")
        return "\n".join(lines)


def _delete_config() -> bool:
    """Remove the on-disk config.json if present. Returns True if deleted."""
    if os.path.exists(db.CONFIG_PATH):
        try:
            os.remove(db.CONFIG_PATH)
            return True
        except OSError:
            return False
    return False


def _clear_api_keys() -> int:
    """Remove every api_key we wrote to the OS keyring / fallback file."""
    return db.clear_all_api_keys()


def _clear_history_rows() -> int:
    """Truncate the history table without removing the file.

    Keeping the file preserves the schema; an empty table is what
    the user wants. Returns the number of rows deleted.
    """
    if not os.path.exists(db.DB_PATH):
        return 0
    conn = None
    try:
        conn = sqlite3.connect(db.DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM history")
        (n,) = cur.fetchone()
        cur.execute("DELETE FROM history")
        # Reset autoincrement so the next row is id=1 (clean slate).
        cur.execute("DELETE FROM sqlite_sequence WHERE name='history'")
        conn.commit()
        return int(n)
    except sqlite3.OperationalError:
        # Table doesn't exist yet — same outcome as empty.
        return 0
    except Exception:
        return 0
    finally:
        if conn:
            conn.close()


def _clear_outputs() -> int:
    """Delete the outputs/ directory contents. Returns file count removed."""
    if not os.path.isdir(db.OUTPUTS_DIR):
        return 0
    count = 0
    try:
        for name in os.listdir(db.OUTPUTS_DIR):
            p = os.path.join(db.OUTPUTS_DIR, name)
            try:
                if os.path.isfile(p) or os.path.islink(p):
                    os.unlink(p)
                    count += 1
                elif os.path.isdir(p):
                    shutil.rmtree(p)
                    count += 1
            except OSError:
                # Skip files we can't delete (locked by another process,
                # permission denied, etc.) — don't fail the whole reset.
                continue
    except OSError:
        pass
    return count


def _clear_ui_state() -> bool:
    """Remove the persisted ui_state.json (window geometry + page).

    Replaces the previous ``QSettings.clear()`` path. Returns
    True if the file was deleted (or didn't exist) — False
    only on a real I/O error, which we don't propagate because
    a failed window-state wipe is not a reason to abort the
    rest of the reset.
    """
    try:
        from core import ui_state

        return ui_state.clear_ui_state()
    except Exception:
        return False


def reset_all() -> ResetReport:
    """Wipe every piece of Tawreed state. Returns a report for the UI.

    This function is synchronous and blocks the calling thread, but
    the operation is bounded — config.json is a few KB, the history
    table is local SQLite, and outputs/ is bounded by the user's
    disk usage. Callers in the UI should run this on a background
    thread if the outputs folder is large.
    """
    report = ResetReport()
    report.config_deleted = _delete_config()
    report.api_keys_cleared = _clear_api_keys()
    report.history_rows_deleted = _clear_history_rows()
    report.outputs_deleted = _clear_outputs()
    report.ui_state_cleared = _clear_ui_state()
    return report
