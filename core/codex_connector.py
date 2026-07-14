"""Least-privilege Codex integration backed by the official app-server protocol.

Tawreed reuses an existing Codex ChatGPT login.  It never reads, copies, or
stores Codex credentials.  Model discovery uses ``account/read`` and
``model/list``; classification remains an ephemeral, schema-bound CLI turn in a
private temporary directory.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from core.metadata import __version__

_active_processes: set[subprocess.Popen] = set()
_active_processes_lock = threading.Lock()

MAX_CODEX_OUTPUT_BYTES = 1_000_000
MAX_APP_SERVER_OUTPUT_BYTES = 2_000_000
CODEX_TIMEOUT_SECONDS = 180
CODEX_CATALOG_TIMEOUT_SECONDS = 30
_FORBIDDEN_EVENT_MARKERS = (
    '"command_execution"',
    '"file_change"',
    '"mcp_tool_call"',
    '"web_search"',
)


@dataclass(frozen=True)
class ProcessOutput:
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class CodexRuntime:
    available: bool
    executable: str | None
    version: str = ""
    message: str = ""


@dataclass(frozen=True)
class CodexAvailability:
    available: bool
    executable: str | None
    message: str
    version: str = ""
    auth_type: str | None = None


@dataclass(frozen=True)
class CodexModel:
    model_id: str
    display_name: str
    is_default: bool = False


@dataclass(frozen=True)
class CodexModelCatalog:
    models: list[CodexModel] = field(default_factory=list)
    default_model: str | None = None
    executable: str | None = None
    version: str = ""
    auth_type: str | None = None
    message: str = ""


class CodexConnectorError(RuntimeError):
    """A safe, user-facing Codex connector failure."""


def _is_private_windowsapps_path(path: Path) -> bool:
    if os.name != "nt":
        return False
    normalized = str(path).replace("/", "\\").casefold()
    return "\\program files\\windowsapps\\" in normalized


def _candidate_paths() -> list[Path]:
    """Return plausible official Codex runtimes in priority order.

    The Store application's private ``WindowsApps`` runtime is intentionally
    excluded: Windows does not allow other desktop processes to launch it.
    """

    candidates: list[Path] = []
    override = os.environ.get("TAWREED_CODEX_CLI", "").strip()
    if override:
        candidates.append(Path(override).expanduser())

    for name in ("codex", "codex.exe"):
        resolved = shutil.which(name)
        if resolved:
            candidates.append(Path(resolved))

    if os.name == "nt":
        local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
        if str(local_app_data):
            desktop_bins = list((local_app_data / "OpenAI" / "Codex" / "bin").glob("*/codex.exe"))
            desktop_bins.sort(key=lambda item: item.stat().st_mtime, reverse=True)
            candidates.extend(desktop_bins)

            winget_bins = list(
                (local_app_data / "Microsoft" / "WinGet" / "Packages").glob(
                    "OpenAI.Codex_*/codex-x86_64-pc-windows-msvc.exe"
                )
            )
            winget_bins.sort(key=lambda item: item.stat().st_mtime, reverse=True)
            candidates.extend(winget_bins)

    # WinGet's package folder can be on PATH even when its stable command alias
    # is missing. Keep it as a fallback after the current desktop-managed CLI.
    resolved = shutil.which("codex-x86_64-pc-windows-msvc.exe")
    if resolved:
        candidates.append(Path(resolved))

    seen: set[str] = set()
    unique: list[Path] = []
    for candidate in candidates:
        try:
            absolute = candidate.resolve(strict=False)
        except OSError:
            absolute = candidate.absolute()
        key = os.path.normcase(str(absolute))
        if key in seen or _is_private_windowsapps_path(absolute):
            continue
        seen.add(key)
        unique.append(absolute)
    return unique


def discover_codex_runtime(timeout: int = 5) -> CodexRuntime:
    """Find the first runnable Codex CLI, continuing past stale/denied paths."""

    attempted = False
    for candidate in _candidate_paths():
        if not candidate.is_file():
            continue
        if os.name == "nt" and candidate.suffix.lower() not in {".exe", ".com"}:
            continue
        attempted = True
        try:
            result = subprocess.run(
                [str(candidate), "--version"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        version = (result.stdout or result.stderr).strip().splitlines()
        if result.returncode == 0 and version:
            return CodexRuntime(
                True,
                str(candidate),
                version[0][:120],
                f"Found {version[0][:120]}.",
            )

    if attempted:
        return CodexRuntime(
            False,
            None,
            message="Codex was found but none of the installed runtimes could be launched.",
        )
    return CodexRuntime(
        False,
        None,
        message="Codex CLI was not found. Install Codex CLI or the Codex desktop app first.",
    )


def find_codex_executable() -> str | None:
    """Compatibility wrapper returning only the verified executable path."""

    return discover_codex_runtime().executable


def check_codex_availability(timeout: int = 10) -> CodexAvailability:
    """Run a no-usage check for a runnable CLI and a ChatGPT-backed login."""

    runtime = discover_codex_runtime(timeout=min(timeout, 5))
    if not runtime.available or not runtime.executable:
        return CodexAvailability(False, None, runtime.message, runtime.version)
    try:
        result = subprocess.run(
            [runtime.executable, "login", "status"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except PermissionError:
        return CodexAvailability(
            False,
            runtime.executable,
            "Windows blocked the Codex runtime. Repair or reinstall the standalone Codex CLI.",
            runtime.version,
        )
    except subprocess.TimeoutExpired:
        return CodexAvailability(
            False,
            runtime.executable,
            "Codex did not respond while checking the login.",
            runtime.version,
        )
    except OSError:
        return CodexAvailability(
            False,
            runtime.executable,
            "Could not start Codex to check the login.",
            runtime.version,
        )

    status_text = f"{result.stdout}\n{result.stderr}".casefold()
    if result.returncode != 0:
        return CodexAvailability(
            False,
            runtime.executable,
            "Codex is not signed in. Run 'codex login' and choose ChatGPT.",
            runtime.version,
        )
    if "api key" in status_text or "apikey" in status_text:
        return CodexAvailability(
            False,
            runtime.executable,
            "Codex is signed in with an API key. Sign in with ChatGPT to use Codex plan usage.",
            runtime.version,
            "apikey",
        )
    auth_type = "chatgpt" if "chatgpt" in status_text else "authenticated"
    return CodexAvailability(
        True,
        runtime.executable,
        f"Connected through ChatGPT login ({runtime.version}). No API key is used.",
        runtime.version,
        auth_type,
    )


def _minimal_environment() -> dict[str, str]:
    allowed = {
        "APPDATA",
        "CODEX_CA_CERTIFICATE",
        "CODEX_HOME",
        "HOME",
        "LOCALAPPDATA",
        "PATH",
        "SSL_CERT_FILE",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
    }
    return {key: value for key, value in os.environ.items() if key.upper() in allowed}


def _terminate_process_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        taskkill = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32" / "taskkill.exe"
        subprocess.run(
            [str(taskkill), "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    else:
        os.killpg(process.pid, signal.SIGKILL)


def cancel_active_codex_processes() -> int:
    """Terminate every active usage-bearing Codex process tree.

    Tawreed runs Codex inside a worker thread. Cancelling the awaiting asyncio
    task cannot stop that thread, so the desktop host calls this explicit
    process-tree boundary before terminating the Python sidecar.
    """
    with _active_processes_lock:
        processes = tuple(_active_processes)
    cancelled = 0
    for process in processes:
        if process.poll() is None:
            _terminate_process_tree(process)
            cancelled += 1
    return cancelled


def _start_app_server(executable: str) -> subprocess.Popen:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if os.name == "nt":
        creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return subprocess.Popen(
        [executable, "app-server"],
        env=_minimal_environment(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        shell=False,
        creationflags=creationflags,
        start_new_session=os.name != "nt",
    )


def _send_rpc(process: subprocess.Popen, payload: dict) -> None:
    if process.stdin is None:
        raise CodexConnectorError("Codex app-server input stream is unavailable.")
    process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
    process.stdin.flush()


def _wait_for_rpc(
    process: subprocess.Popen,
    messages: queue.Queue[str],
    request_id: int,
    deadline: float,
) -> dict:
    total_bytes = 0
    while time.monotonic() < deadline:
        if process.poll() is not None and messages.empty():
            raise CodexConnectorError("Codex app-server stopped unexpectedly.")
        remaining = max(0.05, deadline - time.monotonic())
        try:
            line = messages.get(timeout=remaining)
        except queue.Empty as exc:
            raise CodexConnectorError("Codex model discovery timed out.") from exc
        total_bytes += len(line.encode("utf-8", errors="replace"))
        if total_bytes > MAX_APP_SERVER_OUTPUT_BYTES:
            raise CodexConnectorError("Codex model discovery returned too much data.")
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CodexConnectorError("Codex returned an invalid model-catalog response.") from exc
        if message.get("id") != request_id:
            continue
        if "error" in message:
            error = message.get("error") or {}
            safe_message = str(error.get("message") or "Codex request failed.")[:240]
            raise CodexConnectorError(safe_message)
        return message.get("result") or {}
    raise CodexConnectorError("Codex model discovery timed out.")


def fetch_codex_models(timeout: int = CODEX_CATALOG_TIMEOUT_SECONDS) -> CodexModelCatalog:
    """Fetch the account-visible Codex model catalog without consuming usage."""

    runtime = discover_codex_runtime()
    if not runtime.available or not runtime.executable:
        raise CodexConnectorError(runtime.message)

    process: subprocess.Popen | None = None
    messages: queue.Queue[str] = queue.Queue()
    stderr_bytes = 0

    def read_stdout() -> None:
        if process is None or process.stdout is None:
            return
        for line in process.stdout:
            messages.put(line)

    def drain_stderr() -> None:
        nonlocal stderr_bytes
        if process is None or process.stderr is None:
            return
        for line in process.stderr:
            stderr_bytes += len(line.encode("utf-8", errors="replace"))
            if stderr_bytes > MAX_APP_SERVER_OUTPUT_BYTES:
                break

    try:
        process = _start_app_server(runtime.executable)
        threading.Thread(target=read_stdout, daemon=True).start()
        threading.Thread(target=drain_stderr, daemon=True).start()
        deadline = time.monotonic() + timeout

        _send_rpc(
            process,
            {
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "tawreed",
                        "title": "Tawreed",
                        "version": __version__,
                    }
                },
            },
        )
        _wait_for_rpc(process, messages, 1, deadline)
        _send_rpc(process, {"method": "initialized", "params": {}})

        _send_rpc(
            process,
            {"method": "account/read", "id": 2, "params": {"refreshToken": False}},
        )
        account_result = _wait_for_rpc(process, messages, 2, deadline)
        account = account_result.get("account") or {}
        auth_type = str(account.get("type") or "").casefold()
        if not account:
            raise CodexConnectorError(
                "Codex is not signed in. Run 'codex login' and choose ChatGPT."
            )
        if auth_type != "chatgpt":
            raise CodexConnectorError(
                "Codex is not using ChatGPT login. Sign in with ChatGPT to use Codex plan usage."
            )

        models: list[CodexModel] = []
        cursor: str | None = None
        request_id = 3
        while True:
            params: dict[str, object] = {"limit": 100, "includeHidden": False}
            if cursor:
                params["cursor"] = cursor
            _send_rpc(
                process,
                {"method": "model/list", "id": request_id, "params": params},
            )
            result = _wait_for_rpc(process, messages, request_id, deadline)
            for item in result.get("data") or []:
                if not isinstance(item, dict) or item.get("hidden") is True:
                    continue
                model_id = str(item.get("model") or item.get("id") or "").strip()
                if not model_id:
                    continue
                models.append(
                    CodexModel(
                        model_id=model_id,
                        display_name=str(item.get("displayName") or model_id),
                        is_default=bool(item.get("isDefault")),
                    )
                )
            cursor = result.get("nextCursor")
            if not cursor:
                break
            request_id += 1

        deduped: dict[str, CodexModel] = {}
        for model in models:
            deduped.setdefault(model.model_id.casefold(), model)
        visible = list(deduped.values())
        if not visible:
            raise CodexConnectorError("Codex returned no models available to this account.")
        default_model = next((m.model_id for m in visible if m.is_default), visible[0].model_id)
        return CodexModelCatalog(
            models=visible,
            default_model=default_model,
            executable=runtime.executable,
            version=runtime.version,
            auth_type="chatgpt",
            message=(
                f"Connected through ChatGPT login; fetched {len(visible)} live models "
                f"from {runtime.version}. No API key or model usage was used."
            ),
        )
    except PermissionError as exc:
        raise CodexConnectorError(
            "Windows blocked the Codex runtime. Repair or reinstall the standalone Codex CLI."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise CodexConnectorError("Codex model discovery timed out.") from exc
    except OSError as exc:
        raise CodexConnectorError("Could not start the Codex app-server.") from exc
    finally:
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    _terminate_process_tree(process)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except OSError:
                        pass


def _run_process(
    args: list[str], *, prompt: str, cwd: str, env: dict[str, str], timeout: int
) -> ProcessOutput:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if os.name == "nt":
        creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    process = subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
        creationflags=creationflags,
        start_new_session=os.name != "nt",
    )
    with _active_processes_lock:
        _active_processes.add(process)
    try:
        try:
            stdout, stderr = process.communicate(prompt, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            _terminate_process_tree(process)
            process.communicate()
            raise TimeoutError("Codex did not finish within the safe time limit.") from exc
    finally:
        with _active_processes_lock:
            _active_processes.discard(process)
    return ProcessOutput(process.returncode, stdout, stderr)


def run_codex_cli(system_prompt: str, user_json: str, model_id: str = "") -> str:
    """Run one schema-bound Codex classification without exposing app files."""

    availability = check_codex_availability()
    if not availability.available or not availability.executable:
        raise CodexConnectorError(availability.message)

    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "minLength": 1, "maxLength": 80},
                        "work_package": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 120,
                        },
                    },
                    "required": ["id", "work_package"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    }
    prompt = (
        f"{system_prompt}\n\n"
        "Return the schema-constrained classification for this JSON data only. "
        "In the output, items is an array of objects containing id and work_package. "
        "Do not run commands, inspect files, use MCP, or use web search.\n"
        f"{user_json}"
    )
    if len(prompt) > 30_000:
        raise ValueError("The Codex prompt exceeds the safe batch-size limit.")

    with tempfile.TemporaryDirectory(prefix="tawreed-codex-") as temp_dir:
        if os.name != "nt":
            os.chmod(temp_dir, 0o700)
        schema_path = Path(temp_dir) / "output.schema.json"
        result_path = Path(temp_dir) / "result.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")

        args = [
            availability.executable,
            "--ask-for-approval",
            "never",
            "--sandbox",
            "read-only",
            "exec",
            "--ephemeral",
            "--json",
            "--ignore-user-config",
            "--ignore-rules",
            "--skip-git-repo-check",
            "--color",
            "never",
            "--output-schema",
            str(schema_path),
            "--output-last-message",
            str(result_path),
        ]
        if model_id and model_id != "default":
            args.extend(["--model", model_id])
        args.append("-")

        process = _run_process(
            args,
            prompt=prompt,
            cwd=temp_dir,
            env=_minimal_environment(),
            timeout=CODEX_TIMEOUT_SECONDS,
        )
        combined_size = len(process.stdout.encode()) + len(process.stderr.encode())
        if combined_size > MAX_CODEX_OUTPUT_BYTES:
            raise CodexConnectorError("Codex produced more diagnostic output than the safe limit.")
        events = process.stdout.casefold()
        if any(marker in events for marker in _FORBIDDEN_EVENT_MARKERS):
            raise CodexConnectorError(
                "Codex attempted a tool action; the classification was rejected."
            )
        if process.returncode != 0:
            failure = f"{process.stdout}\n{process.stderr}".casefold()
            if "model_not_found" in failure or "model is not available" in failure:
                message = "The selected Codex model is no longer available. Refresh the model list."
            elif "usage" in failure or "rate_limit" in failure or "rate limit" in failure:
                message = (
                    "Codex login is valid, but plan usage is currently unavailable or limited."
                )
            elif "unauthorized" in failure or "authentication" in failure:
                message = "The Codex login expired. Run 'codex login' again."
            elif "invalid_json_schema" in failure:
                message = "Codex rejected the classification output schema."
            else:
                message = (
                    "Codex could not complete the classification. "
                    "Check login, model access, and usage limits."
                )
            raise CodexConnectorError(message)
        if not result_path.is_file():
            raise CodexConnectorError("Codex did not produce a final classification result.")
        raw_result = result_path.read_text(encoding="utf-8")
        if len(raw_result.encode()) > MAX_CODEX_OUTPUT_BYTES:
            raise CodexConnectorError("Codex returned a result larger than the safe limit.")
        parsed = json.loads(raw_result)
        if not isinstance(parsed, dict):
            raise CodexConnectorError("Codex returned an invalid classification result.")
        raw_items = parsed.get("items")
        if isinstance(raw_items, list):
            normalized: dict[str, str] = {}
            for item in raw_items:
                if not isinstance(item, dict):
                    raise CodexConnectorError("Codex returned an invalid classification item.")
                item_id = item.get("id")
                package = item.get("work_package")
                if not isinstance(item_id, str) or not isinstance(package, str):
                    raise CodexConnectorError("Codex returned an invalid classification item.")
                if item_id in normalized:
                    raise CodexConnectorError("Codex returned a duplicate BOQ item ID.")
                normalized[item_id] = package
            return json.dumps({"items": normalized}, ensure_ascii=False)
        if not isinstance(raw_items, dict):
            raise CodexConnectorError("Codex returned an invalid classification result.")
        return raw_result
