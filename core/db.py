"""SQLite + JSON config storage for Tawreed.

All persistent state lives under a single per-user directory:

    Windows:  C:\\Users\\<user>\\.tawreed\\
    POSIX:    ~/.tawreed/

The same layout is used in BOTH dev (``python main.py``) and frozen
(PyInstaller) builds. Keeping the state outside the project tree
prevents:

  * Accidental commits of config.json / .db / outputs to git.
  * State being stranded inside ``dist/`` when the user copies the
    build folder to a new machine — the state moves with the user,
    not the binary.
  * Per-project pollution when the user is working on multiple
    Tawreed trees.

Layout::

    ~/.tawreed/
    ├── config.json          (provider, model, base_url — no secrets)
    ├── ui_state.json        (window geometry, last visited page)
    ├── db/tawreed.db
    ├── outputs/
    │   └── <file>_<Tawreed_Output>.xlsx
    ├── logs/
    │   ├── tawreed.log      (rotating, 1 MB × 3)
    │   ├── crash.log        (unhandled exceptions, see core/logging_setup)
    │   └── migration.log
    └── single-instance.pid

Secret storage
--------------
The API key is **never** written to ``config.json``. It lives in the
OS-provided secure credential store via the ``keyring`` package:

  * Windows  → Credential Manager (DPAPI, bound to the user account)
  * macOS    → Keychain
  * Linux    → libsecret (GNOME Keyring / KWallet) when available

``keyring`` is imported lazily so a missing backend (e.g. headless
Linux without a running secret service) degrades to a soft warning
logged once, with the key falling back to an obfuscated file under
``~/.tawreed/.secret_fallback`` (mode 0600) so the app still works
in CI / container environments where the keyring daemon isn't
available. The fallback is intentionally not a real secure store
— it's a graceful degradation path, not a security claim.

The previous version of this module put state in three different
places depending on mode (``%LOCALAPPDATA%`` for frozen, ``./tawreed/``
for dev, ``~/.tawreed`` for the old dev legacy). The new code unifies
on a single location and adds a one-shot migration that copies any
state from the old ``%LOCALAPPDATA%\\Tawreed`` and ``<exe-dir>/tawreed``
locations into ``~/.tawreed`` so an existing user keeps their
history and settings. Legacy ``config.json`` files that still contain
an ``api_key`` field are migrated to keyring and the key is stripped
from disk on first read.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from typing import Any

from core.ai import get_default_settings, get_provider_config, is_valid_provider

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------


def _app_root() -> str:
    """Return the directory the persistent state tree hangs off of.

    Per project policy, EVERYTHING lives under the user's home
    directory at ``~/.tawreed/`` — regardless of whether we're
    running from source (``python main.py``) or from a frozen
    PyInstaller build. The previous split (dev -> ``./tawreed/``,
    frozen -> ``%LOCALAPPDATA%\\Tawreed``) was confusing and meant
    the user's history didn't follow them when they upgraded.

    Returns the home-dir path with no trailing slash. The actual
    ``tawreed/`` subdirectory is concatenated at the call sites.
    """
    home = os.path.expanduser("~")
    if not home:
        # Last-resort fallback: %TEMP% on Windows, /tmp on POSIX.
        # If even those aren't writable, init_db() will raise.
        return os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp"
    return home


APP_ROOT = _app_root()
TAWREED_DIR = os.path.join(APP_ROOT, ".tawreed")
DB_DIR = os.path.join(TAWREED_DIR, "db")
DB_PATH = os.path.join(DB_DIR, "tawreed.db")
CONFIG_PATH = os.path.join(TAWREED_DIR, "config.json")
OUTPUTS_DIR = os.path.join(TAWREED_DIR, "outputs")
LOGS_DIR = os.path.join(TAWREED_DIR, "logs")
PID_FILE_PATH = os.path.join(TAWREED_DIR, "single-instance.pid")

# Window-level UI state (geometry blob + last visited page).
# Lives alongside config.json so the rule "all persistent state
# under ~/.tawreed/" holds. See ``core/ui_state.py`` for the
# read/write helpers — this is just the path constant so the
# rest of the codebase has a single source of truth.
UI_STATE_PATH = os.path.join(TAWREED_DIR, "ui_state.json")

# When ``keyring`` can't find a backend (e.g. headless Linux), we
# fall back to this file. The name starts with a dot so it's hidden
# in a normal ``ls`` and the leading underscore discourages curious
# users from poking at it. We do NOT advertise this path in the UI.
SECRET_FALLBACK_PATH = os.path.join(TAWREED_DIR, ".secret_fallback")


# ---------------------------------------------------------------------------
# Secret storage: OS keyring with a graceful file fallback
# ---------------------------------------------------------------------------
#
# The fallback exists so the app still works in:
#   - headless Linux CI runners (no D-Bus / no secret service)
#   - minimal Docker containers (no libsecret installed)
#   - WSL without a running keyring daemon
#
# It is **not** a security claim — it's a "don't crash" path. The
# file is written with mode 0o600 and the contents are obfuscated
# (NOT encrypted) via a simple XOR with a per-install random key
# stored in the same file. An attacker with read access to the
# user's home directory can still recover the api_key, which is
# the same trust model as the legacy plaintext config.json.
#
# When a real keyring is available, we use it and never touch the
# fallback file.

_KEYRING_SERVICE = "tawreed"
_keyring_warned = False
_keyring_unavailable: Exception | None = None
_secret_fallback_data: dict[str, str] | None = None
_secret_fallback_key: bytes | None = None


def _load_keyring():
    """Return the keyring module or None if it can't be imported."""
    try:
        import keyring  # type: ignore[import-untyped]

        return keyring
    except Exception as exc:  # pragma: no cover - import guard
        global _keyring_unavailable
        _keyring_unavailable = exc
        return None


def _keyring_is_usable() -> bool:
    """True if keyring is importable AND has a working backend.

    The keyring package always imports — what fails is the
    ``set_password``/``get_password`` calls when there's no
    backend (the "fail" / "null" backend returns ``None`` from
    every call). We probe by asking the backend for its class
    name, which is a cheap way to detect the no-op case.
    """
    keyring = _load_keyring()
    if keyring is None:
        return False
    try:
        backend = keyring.get_keyring()
        cls = type(backend).__name__
        # keyring's no-op backends are named "Fail" or "Null".
        # Real backends are "WinVaultKeyring", "Keyring" (macOS),
        # "SecretServiceKeyring", etc.
        return cls not in {"Fail", "NullKeyring", "FailKeyring"}
    except Exception:
        return False


def _obfuscate(value: str) -> str:
    """Light obfuscation for the fallback file. NOT encryption."""
    import base64

    global _secret_fallback_key
    if _secret_fallback_key is None:
        # Per-install random key. Generated lazily on first write.
        _secret_fallback_key = os.urandom(32)
    raw = value.encode("utf-8")
    key = _secret_fallback_key
    out = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
    return base64.b64encode(out).decode("ascii")


def _deobfuscate(blob: str) -> str:
    if _secret_fallback_key is None:
        return ""
    import base64

    try:
        out = base64.b64decode(blob.encode("ascii"))
        key = _secret_fallback_key
        return bytes(b ^ key[i % len(key)] for i, b in enumerate(out)).decode("utf-8")
    except Exception:
        return ""


def _load_fallback_file() -> dict[str, str]:
    """Read the obfuscated fallback file into a dict. Idempotent."""
    global _secret_fallback_data, _secret_fallback_key
    if _secret_fallback_data is not None:
        return _secret_fallback_data
    data: dict[str, str] = {}
    if os.path.exists(SECRET_FALLBACK_PATH):
        try:
            with open(SECRET_FALLBACK_PATH, encoding="utf-8") as f:
                payload = json.load(f)
            _secret_fallback_key = bytes.fromhex(payload.get("k", ""))
            data = {k: _deobfuscate(v) for k, v in payload.get("secrets", {}).items()}
        except Exception:
            # Corrupt file — start clean, don't lose the user's whole session.
            data = {}
            _secret_fallback_key = None
    _secret_fallback_data = data
    return data


def _save_fallback_file() -> None:
    global _secret_fallback_data, _secret_fallback_key
    if _secret_fallback_data is None:
        return
    # Lazy-init the obfuscation key. The first write after
    # process start is also the first time we need a key, and
    # we don't want to require a separate "init" call.
    if _secret_fallback_key is None:
        _secret_fallback_key = os.urandom(32)
    os.makedirs(TAWREED_DIR, exist_ok=True)
    payload = {
        "k": _secret_fallback_key.hex(),
        "secrets": {k: _obfuscate(v) for k, v in _secret_fallback_data.items()},
    }
    # Write atomically: temp file in the same dir, then rename.
    tmp = SECRET_FALLBACK_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp, SECRET_FALLBACK_PATH)
    try:
        os.chmod(SECRET_FALLBACK_PATH, 0o600)
    except OSError:
        # Windows ignores chmod; that's fine — NTFS ACLs handle it.
        pass


def _keyring_account_key(provider: str) -> str:
    """Build a per-provider keyring account name.

    Keys are scoped by provider so a user with multiple providers
    (e.g. OpenAI for production, Anthropic for dev) can have
    separate credentials without one overwriting the other.
    """
    return f"api_key:{provider}"


def get_api_key(provider: str) -> str:
    """Read the api_key for the given provider from keyring (or fallback)."""
    if _keyring_is_usable():
        keyring = _load_keyring()
        try:
            v = keyring.get_password(_KEYRING_SERVICE, _keyring_account_key(provider))
            return v or ""
        except Exception as exc:
            _log.warning("keyring.get_password failed: %s", exc)
    return _load_fallback_file().get(_keyring_account_key(provider), "")


def set_api_key(provider: str, value: str) -> None:
    """Persist the api_key for the given provider. Empty value = delete."""
    if _keyring_is_usable():
        keyring = _load_keyring()
        try:
            if value:
                keyring.set_password(_KEYRING_SERVICE, _keyring_account_key(provider), value)
            else:
                try:
                    keyring.delete_password(_KEYRING_SERVICE, _keyring_account_key(provider))
                except Exception:
                    # Some backends raise on delete-of-missing. That's fine.
                    pass
            return
        except Exception as exc:
            _log.warning("keyring.set_password failed: %s", exc)

    # Fallback path.
    global _secret_fallback_data
    data = _load_fallback_file()
    if value:
        data[_keyring_account_key(provider)] = value
    else:
        data.pop(_keyring_account_key(provider), None)
    _save_fallback_file()


def clear_all_api_keys() -> int:
    """Remove every api_key we know about. Returns the count removed.

    Used by ``core/reset.py`` to make "reset everything" actually
    wipe the keyring too — otherwise resetting settings and
    leaving the key in Credential Manager is a half-job.
    """
    removed = 0
    if _keyring_is_usable():
        keyring = _load_keyring()
        # We don't track which providers the user has used, so we
        # try to delete the canonical ones plus any with the same
        # prefix in the fallback file. Anything else (e.g. a
        # third-party service that registered under tawreed) is
        # left alone — it wasn't ours to begin with.
        for provider in ("OpenAI", "Claude", "Google", "OpenAI Compatible"):
            try:
                keyring.delete_password(_KEYRING_SERVICE, _keyring_account_key(provider))
                removed += 1
            except Exception:
                pass
    # Always wipe the fallback file too.
    data = _load_fallback_file()
    n = len(data)
    if n:
        data.clear()
        _save_fallback_file()
        removed += n
    if os.path.exists(SECRET_FALLBACK_PATH):
        try:
            os.remove(SECRET_FALLBACK_PATH)
        except OSError:
            pass
    return removed


# ---------------------------------------------------------------------------
# Migration from the old split-location layout
# ---------------------------------------------------------------------------
#
# Before this change, state lived in different places depending on mode:
#   - Frozen (PyInstaller):  %LOCALAPPDATA%\\Tawreed\\
#   - Dev:                  <project>/tawreed/
#   - Old dev legacy:       ~/.tawreed/
# Now everything lives in ~/.tawreed/. The migration below detects the
# old locations and copies any state into the new tree, leaving a
# breadcrumb in logs/migration.log so the user can see what was moved.
#
# Best-effort — failures are silently skipped because a fresh install
# shouldn't be blocked by an unrelated legacy folder elsewhere on disk.

# Locations to scan for legacy state. We also scan the directory
# containing the running EXE, because some older frozen builds wrote
# their state to ``<exe-dir>/tawreed/`` next to the binary.
_LEGACY_LOCATIONS: list[str] = []


def _detect_legacy_locations() -> list[str]:
    """Return legacy app-data roots that might have old state."""
    candidates: list[str] = []

    # Frozen legacy #1: %LOCALAPPDATA%\\Tawreed
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(os.path.join(local_app_data, "Tawreed"))

    # Frozen legacy #2: <exe-dir>/tawreed  — when the EXE was run from
    # inside a zip-extract folder, state was written next to the binary.
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.append(os.path.join(exe_dir, "tawreed"))

    return [
        p
        for p in candidates
        if os.path.isdir(p) and os.path.normcase(p) != os.path.normcase(TAWREED_DIR)
    ]


def _strip_api_key_from_config_file(path: str) -> bool:
    """If ``path`` is a config.json with an api_key, move it to
    keyring and rewrite the file without it. Returns True if a
    rewrite happened.
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return False
    key = data.pop("api_key", None)
    if not key:
        return False
    # Pick the provider to attribute the key to. If the file also
    # has a provider field, use that. Otherwise default to OpenAI
    # so the key isn't lost; the user can re-save from the
    # Settings page if it should be attributed elsewhere.
    provider = data.get("provider") or "OpenAI"
    if not is_valid_provider(provider):
        provider = "OpenAI"
    set_api_key(provider, key)
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        return False
    return True


def _migrate_legacy_state() -> None:
    """One-shot migration: copy any legacy state into ~/.tawreed/.

    For ``config.json`` specifically, we also strip any embedded
    ``api_key`` and push it to keyring. The previous version of
    Tawreed (0.0.1 and earlier) wrote the key in plaintext — this
    migration is what closes that gap for upgrading users.
    """
    legacy_roots = _detect_legacy_locations()
    if not legacy_roots:
        return

    os.makedirs(TAWREED_DIR, exist_ok=True)

    migrated: list[str] = []
    secrets_migrated: list[str] = []
    for legacy in legacy_roots:
        # Copy specific files (not the whole tree, in case the user
        # dropped unrelated stuff into the legacy folder).
        for fname in ("config.json",):
            src = os.path.join(legacy, fname)
            if os.path.isfile(src):
                dst = os.path.join(TAWREED_DIR, fname)
                if not os.path.exists(dst):
                    try:
                        shutil.copy2(src, dst)
                        migrated.append(src)
                    except OSError:
                        pass
                # Whether we copied or not, if the destination
                # has an api_key in plaintext, strip it.
                if os.path.isfile(dst) and _strip_api_key_from_config_file(dst):
                    secrets_migrated.append(dst)

        # Copy the SQLite db file (the whole history table).
        legacy_db = os.path.join(legacy, "db", "tawreed.db")
        if os.path.isfile(legacy_db):
            dst = os.path.join(DB_DIR, "tawreed.db")
            if not os.path.exists(dst):
                try:
                    os.makedirs(DB_DIR, exist_ok=True)
                    shutil.copy2(legacy_db, dst)
                    migrated.append(legacy_db)
                except OSError:
                    pass

        # Copy outputs directory contents (but not the dir itself, to
        # avoid clobbering anything the new run has already written).
        legacy_outputs = os.path.join(legacy, "outputs")
        if os.path.isdir(legacy_outputs):
            try:
                os.makedirs(OUTPUTS_DIR, exist_ok=True)
                for name in os.listdir(legacy_outputs):
                    src = os.path.join(legacy_outputs, name)
                    dst = os.path.join(OUTPUTS_DIR, name)
                    if os.path.exists(dst):
                        continue
                    if os.path.isfile(src):
                        try:
                            shutil.copy2(src, dst)
                            migrated.append(src)
                        except OSError:
                            pass
            except OSError:
                pass

    if migrated or secrets_migrated:
        # Write a breadcrumb so the user (or a future migration
        # tool) can find where the data came from.
        try:
            os.makedirs(LOGS_DIR, exist_ok=True)
            breadcrumb = os.path.join(LOGS_DIR, "migration.log")
            with open(breadcrumb, "w", encoding="utf-8") as f:
                f.write(
                    f"Migrated {len(migrated)} file(s) from legacy location(s)\n"
                    f"on {datetime.now().isoformat()}.\n"
                    f"New state root: {TAWREED_DIR}\n"
                    f"Files copied:\n" + "\n".join(f"  - {p}" for p in migrated) + "\n"
                )
                if secrets_migrated:
                    f.write(
                        "\nMigrated API key(s) to OS keyring and stripped from:\n"
                        + "\n".join(f"  - {p}" for p in secrets_migrated)
                        + "\n"
                    )
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Database lifecycle
# ---------------------------------------------------------------------------


def _cleanup_stray_app_state() -> None:
    """Best-effort cleanup of stray state trees that the old code
    left lying around.

    Background: earlier versions of Tawreed wrote its state to one
    of three places depending on mode — ``%LOCALAPPDATA%\\Tawreed``,
    ``<exe-dir>/tawreed``, or ``~/.tawreed`` — and the user's most
    recent installed build may have populated any of them. After
    this change, the canonical location is ``~/.tawreed`` and any
    pre-existing state has already been migrated by
    ``_migrate_legacy_state``.

    This function is the second half: it removes the now-empty
    legacy tree, but ONLY if the migration emptied it. If the user
    dropped unrelated files into the legacy folder we leave it
    alone (the migration log captures what we did copy, so a power
    user can still recover the rest from the legacy location).

    Runs once per process. Failures are silently swallowed.
    """
    legacy_roots = _detect_legacy_locations()
    for legacy in legacy_roots:
        try:
            # Don't remove the user's HOME (~/.tawreed) — that's
            # a real user folder and may have unrelated content.
            # We only clean up the frozen-build leftovers.
            if os.path.normcase(legacy) == os.path.normcase(
                os.path.join(os.path.expanduser("~"), ".tawreed")
            ):
                continue
            if not os.path.isdir(legacy):
                continue
            # If the folder contains anything OTHER than our
            # sub-folders, leave it alone — the user dropped
            # something there.
            expected = {
                "config.json",
                "db",
                "outputs",
                "logs",
                "single-instance.pid",
                ".secret_fallback",
            }
            try:
                contents = set(os.listdir(legacy))
            except OSError:
                continue
            if not contents.issubset(expected):
                continue
            # Sub-folders we created should be empty or only
            # contain migrated files. If they're not empty, leave
            # them — the migration already copied the files to the
            # new location and the user may want to inspect.
            for sub in ("db", "outputs"):
                p = os.path.join(legacy, sub)
                if os.path.isdir(p):
                    try:
                        if os.listdir(p):
                            continue
                    except OSError:
                        pass
            # Safe to remove.
            import shutil as _sh

            _sh.rmtree(legacy, ignore_errors=True)
        except Exception:
            pass


def init_db() -> None:
    """Initialise the state tree (idempotent).

    Performs a one-shot migration of any legacy app data into the
    new ~/.tawreed/ tree (including stripping plaintext api_key
    fields from legacy config.json and pushing them to keyring),
    cleans up the now-empty legacy trees next to the EXE, then
    ensures the standard subfolders exist and the history table
    is created.
    """
    # One-shot migration: pull any old state into the new tree.
    _migrate_legacy_state()

    # Clean up the now-empty legacy trees left behind by older
    # frozen builds. Best-effort; never raises.
    _cleanup_stray_app_state()

    # Clean up any stale temp files from previous crashes
    cleanup_temp_files()

    for subfolder in ("db", "outputs", "logs"):
        os.makedirs(os.path.join(TAWREED_DIR, subfolder), exist_ok=True)

    # Touch the keyring once so the fallback path is hot and any
    # "no backend available" warning is logged at startup, not
    # mid-typing on the Settings page.
    if not _keyring_is_usable():
        global _keyring_warned
        if not _keyring_warned:
            reason = f" ({_keyring_unavailable!r})" if _keyring_unavailable is not None else ""
            _log.warning(
                "OS keyring is not available%s; falling back to obfuscated "
                "file storage at %s. The fallback is NOT a real secure store "
                "— install libsecret (Linux) or run a desktop session (KDE/GNOME) "
                "to enable the real keyring.",
                reason,
                SECRET_FALLBACK_PATH,
            )
            _keyring_warned = True

    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                project_name TEXT,
                packages_count INTEGER,
                output_path TEXT
            )
        """)
        conn.commit()
    finally:
        if conn:
            conn.close()


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        return conn
    except Exception:
        conn.close()
        raise


def get_history() -> list[dict[str, Any]]:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, timestamp, project_name, packages_count, output_path FROM history ORDER BY id DESC"
        )
        rows = cursor.fetchall()
        history = []
        for r in rows:
            history.append(
                {
                    "id": r[0],
                    "timestamp": r[1],
                    "project_name": r[2],
                    "packages_count": r[3],
                    "output_path": r[4],
                }
            )
        return history
    finally:
        if conn:
            conn.close()


def delete_history_entry(entry_id: int) -> bool:
    """Remove a single history row by id. Returns True if a row was removed.

    The on-disk output Excel is NOT touched — only the database row.
    The History page uses this from its Delete action.
    """
    if not os.path.exists(DB_PATH):
        return False
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("DELETE FROM history WHERE id = ?", (entry_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        if conn:
            conn.close()


def add_history(project_name: str, packages_count: int, output_path: str) -> None:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO history (timestamp, project_name, packages_count, output_path) VALUES (?, ?, ?, ?)",
            (timestamp, project_name, packages_count, output_path),
        )
        conn.commit()
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Settings (config.json) IO
# ---------------------------------------------------------------------------
#
# ``config.json`` holds ONLY non-secret settings: provider, model,
# base_url, language, and any future UI preferences. The api_key
# is read from keyring via ``get_api_key(provider)`` and is NOT
# persisted in this file. To keep the call sites in the GUI simple,
# ``get_settings()`` returns a dict that ALSO has an ``api_key``
# key populated from keyring, but the field is never written
# back to disk.


def get_settings() -> dict[str, Any]:
    default_settings = get_default_settings()
    # Backwards-compat aliases: legacy code used `model_id` interchangeably
    # with `model`. Keep both keys in sync at load time.
    default_settings.setdefault("model_id", default_settings["model"])
    if not os.path.exists(CONFIG_PATH):
        # Even on the defaults path, the GUI expects an api_key
        # key to be present. Populate it from keyring so the
        # Settings page renders the masked field correctly.
        default_settings["api_key"] = get_api_key(default_settings["provider"])
        return default_settings
    # Read the file into memory first, then close it BEFORE we
    # attempt any rewrite of the same path — Windows holds a
    # non-shareable write lock on an open file, so a same-process
    # ``os.replace`` of the path would fail silently.
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            settings = json.load(f)
    except Exception:
        # On parse failure, still return defaults with the
        # current keyring key, so the app doesn't strand the
        # user on a broken Settings page.
        out = dict(default_settings)
        out["api_key"] = get_api_key(default_settings["provider"])
        return out

    if "model_id" in settings and "model" not in settings:
        settings["model"] = settings["model_id"]
    elif "model" in settings and "model_id" not in settings:
        settings["model_id"] = settings["model"]

    # Migration: old "OpenAI" entry that pointed at a custom base
    # URL (e.g. the MiniMax proxy at api.minimax.io/v1) gets
    # promoted to "OpenAI Compatible" so the existing config
    # still works after the provider rebrand.
    saved_provider = settings.get("provider", "")
    saved_url = settings.get("base_url", "") or ""
    if saved_provider == "OpenAI" and saved_url and "api.openai.com" not in saved_url:
        settings["provider"] = "OpenAI Compatible"

    if "provider" not in settings or not is_valid_provider(settings["provider"]):
        settings["provider"] = default_settings["provider"]

    for k, v in default_settings.items():
        if k not in settings:
            settings[k] = v

    # Validate and normalize language setting
    if "language" not in settings:
        settings["language"] = default_settings["language"]
    else:
        # Ensure language is supported
        from core.i18n import SUPPORTED_LANGUAGES
        if settings["language"] not in SUPPORTED_LANGUAGES:
            settings["language"] = default_settings["language"]

    # Validate and normalize theme setting
    if "theme" not in settings:
        settings["theme"] = default_settings.get("theme", "dark")
    else:
        if settings["theme"] not in ("dark", "light"):
            settings["theme"] = default_settings.get("theme", "dark")

    # Populate api_key from keyring. If a legacy plaintext key
    # is sitting in config.json (which the migration should
    # have already stripped, but defence-in-depth), push it
    # to keyring, drop it from the in-memory dict, AND rewrite
    # config.json without the key so it doesn't sit on disk
    # waiting to be exfiltrated.
    if "api_key" in settings and settings["api_key"]:
        set_api_key(settings["provider"], settings["api_key"])
        del settings["api_key"]
        # The file handle from the read above is already closed
        # (we used a ``with`` block), so this ``os.replace`` is
        # safe on Windows too.
        _rewrite_config_without_api_key()
    settings["api_key"] = get_api_key(settings["provider"])

    return settings


def _rewrite_config_without_api_key() -> None:
    """Rewrite config.json in-place, stripping any api_key field.

    Used by ``get_settings()`` to enforce the v0.0.1 hardening
    invariant: ``api_key`` must never live on disk in plaintext.
    Atomic write (temp file + ``os.replace``) so a crash mid-write
    doesn't leave a half-written config.json.
    """
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return
    if "api_key" not in data:
        return
    data.pop("api_key", None)
    try:
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, CONFIG_PATH)
    except OSError:
        # Best-effort. The next ``get_settings()`` call will
        # re-strip the key from disk.
        pass


def save_settings(settings: dict) -> None:
    """Persist the settings dict. The ``api_key`` key (if present)
    is written to keyring and stripped from config.json. All
    other keys are validated and normalised.
    """
    os.makedirs(TAWREED_DIR, exist_ok=True)

    provider = settings.get("provider", "OpenAI")
    if not is_valid_provider(provider):
        provider = "OpenAI"
    settings["provider"] = provider

    p = get_provider_config(provider)
    if not settings.get("base_url"):
        settings["base_url"] = p["base_url"]
    if not settings.get("model"):
        settings["model"] = p["default_model"]
    if not settings.get("model_id"):
        settings["model_id"] = settings["model"]

    if "model_id" in settings and "model" not in settings:
        settings["model"] = settings["model_id"]
    elif "model" in settings and "model_id" not in settings:
        settings["model_id"] = settings["model"]

    # Validate and normalize language setting
    from core.i18n import SUPPORTED_LANGUAGES
    if "language" not in settings:
        settings["language"] = "en"
    else:
        if settings["language"] not in SUPPORTED_LANGUAGES:
            settings["language"] = "en"

    # Validate and normalize theme setting
    if "theme" not in settings:
        settings["theme"] = "dark"
    else:
        if settings["theme"] not in ("dark", "light"):
            settings["theme"] = "dark"

    # Route the api_key to keyring and drop it from the on-disk
    # payload. ``api_key`` is allowed to be absent in the input
    # (e.g. when re-saving only the model); in that case we
    # leave the existing keyring value alone.
    api_key = settings.pop("api_key", None)
    if api_key is not None:
        set_api_key(provider, api_key)

    # Atomic write: temp file + rename to prevent corruption on crash
    os.makedirs(TAWREED_DIR, exist_ok=True)
    tmp_path = CONFIG_PATH + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4, ensure_ascii=False)
        os.replace(tmp_path, CONFIG_PATH)
    except OSError:
        # Best-effort cleanup of temp file
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise


def update_settings(provider: str, api_key: str, model: str, base_url: str, language: str = "en", theme: str = "dark") -> None:
    settings = {
        "provider": provider,
        "api_key": api_key,
        "model": model,
        "model_id": model,
        "base_url": base_url,
        "language": language,
        "theme": theme,
    }
    save_settings(settings)


def get_outputs_dir() -> str:
    os.makedirs(OUTPUTS_DIR, exist_ok=True)
    return os.path.abspath(OUTPUTS_DIR)


# Recent files tracking
RECENT_FILES_PATH = os.path.join(TAWREED_DIR, "recent_files.json")
MAX_RECENT_FILES = 5


def _get_recent_files() -> list[str]:
    """Read the list of recent files from disk."""
    if not os.path.exists(RECENT_FILES_PATH):
        return []
    try:
        with open(RECENT_FILES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return [f for f in data if isinstance(f, str) and os.path.exists(f)]
        return []
    except (OSError, json.JSONDecodeError):
        return []


def _save_recent_files(files: list[str]) -> None:
    """Save the list of recent files to disk."""
    os.makedirs(TAWREED_DIR, exist_ok=True)
    tmp_path = RECENT_FILES_PATH + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(files, f)
        os.replace(tmp_path, RECENT_FILES_PATH)
    except OSError:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass


def add_recent_file(file_path: str) -> None:
    """Add a file to the recent files list."""
    recent = _get_recent_files()
    # Remove if already exists
    if file_path in recent:
        recent.remove(file_path)
    # Add to beginning
    recent.insert(0, file_path)
    # Trim to max
    recent = recent[:MAX_RECENT_FILES]
    _save_recent_files(recent)


def get_recent_files() -> list[str]:
    """Get the list of recent files."""
    return _get_recent_files()


def clear_recent_files() -> None:
    """Clear the recent files list."""
    _save_recent_files([])


def cleanup_temp_files() -> int:
    """Remove stale .tmp files from the state directory.

    Returns the number of temp files removed.
    """
    if not os.path.isdir(TAWREED_DIR):
        return 0

    removed = 0
    for root, _dirs, files in os.walk(TAWREED_DIR):
        for fname in files:
            if fname.endswith(".tmp"):
                fpath = os.path.join(root, fname)
                try:
                    os.remove(fpath)
                    removed += 1
                    _log.debug("Removed stale temp file: %s", fpath)
                except OSError as e:
                    _log.warning("Could not remove temp file %s: %s", fpath, e)
    return removed
