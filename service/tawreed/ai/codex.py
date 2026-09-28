"""The ChatGPT subscription, through the official Codex client. Tawreed never reads Codex's sign-in: it runs
`codex exec` locked down, so the model can use Tawreed's tools and nothing else.

- Codex ignores the engineer's own Codex settings, rules and MCP servers, works in an empty folder in a read-only
  sandbox, and its own shell, command, image, sub-agent, app, plugin, browser, computer-use, image-generation,
  skill and web-search tools are off.
- Tawreed's MCP endpoint is its only tool server. It is required, so Codex waits for it and its tools are
  searchable from the start, and approved, so Tawreed's own tools (only they) run without an approval prompt that
  no one would be there to answer.
- The endpoint's one-time token reaches Codex through an environment variable, never the command line.
- The prompt goes in on standard input, which Codex otherwise waits on."""

import asyncio
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tawreed.ai.check import number_image
from tawreed.workflow.mcp_endpoint import Check, Runs

LABEL = "ChatGPT (Codex)"
TOKEN_VARIABLE = "TAWREED_MCP_TOKEN"
RUN_TIME = 20 * 60  # seconds one run of a step may take; the next run carries on from what was saved
FEATURES_OFF = (
    "shell_tool",
    "unified_exec",
    "view_image",
    "multi_agent",
    "apps",
    "plugins",
    "browser_use",
    "computer_use",
    "image_generation",
    "skill_search",
    "tool_suggest",
    "sleep_tool",
)
NO_WINDOW = 0x0800_0000 if os.name == "nt" else 0  # CREATE_NO_WINDOW: no console flashes up for a run


def executable() -> list[str] | None:
    """How to start Codex, if it is installed."""
    path = shutil.which("codex")
    return [path] if path else None


def _quick(arguments: list[str]) -> subprocess.CompletedProcess | None:
    program = executable()
    if program is None:
        return None
    return subprocess.run(
        [*program, *arguments],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        creationflags=NO_WINDOW,
    )


def status() -> dict[str, Any]:
    """Whether Codex is installed, its version, and whether it is signed in (it says so itself)."""
    version = _quick(["--version"])
    if version is None or version.returncode != 0:
        return {"installed": False, "version": None, "signed_in": False}
    signed_in = _quick(["login", "status"])
    return {
        "installed": True,
        "version": version.stdout.strip().split()[-1] if version.stdout.strip() else None,
        "signed_in": bool(signed_in and signed_in.returncode == 0),
    }


def sign_in() -> None:
    """Start Codex's own sign-in in a window of its own; Tawreed never sees the credentials."""
    program = executable()
    if program is None:
        raise FileNotFoundError("codex")
    flags = subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0
    subprocess.Popen([*program, "login"], creationflags=flags)  # noqa: S603


def models() -> list[str]:
    """The models Codex offers this account, from its own catalogue."""
    listed = _quick(["debug", "models"])
    if listed is None or listed.returncode != 0:
        return []
    catalogue = json.loads(listed.stdout)
    return [m["slug"] for m in catalogue.get("models", []) if m.get("visibility") == "list"]


def command(model: str | None, folder: Path, url: str, images: list[Path]) -> list[str]:
    program = executable() or ["codex"]
    arguments = [
        *program,
        "exec",
        "--json",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-C",
        str(folder),
        "-c",
        'web_search="disabled"',
        "-c",
        f"mcp_servers.tawreed.url={json.dumps(url)}",
        "-c",
        f"mcp_servers.tawreed.bearer_token_env_var={json.dumps(TOKEN_VARIABLE)}",
        "-c",
        "mcp_servers.tawreed.required=true",
        "-c",
        'mcp_servers.tawreed.default_tools_approval_mode="approve"',
        "-c",
        "mcp_servers.tawreed.tool_timeout_sec=300",
    ]
    for feature in FEATURES_OFF:
        arguments += ["--disable", feature]
    if model:
        arguments += ["-m", model]
    for image in images:
        arguments += ["-i", str(image)]
    return [*arguments, "-"]  # the prompt comes on standard input


@dataclass
class Outcome:
    """How a Codex run ended: done | stopped | out_of_time | failed."""

    ended: str = "done"
    problem: str | None = None  # a code the interface explains, when it failed
    calls: list[dict[str, Any]] = field(default_factory=list)  # {tool, sent_back}
    input_tokens: int = 0
    output_tokens: int = 0


def explain(message: str) -> str:
    text = message.lower()
    if "login" in text or "sign in" in text or "unauthorized" in text or "401" in text:
        return "codex_signed_out"
    if "usage limit" in text or "rate limit" in text or "429" in text:
        return "rate_limited"
    return "codex_failed"


async def run(
    model: str | None, prompt: str, url: str, token: str, stop: threading.Event, images: list[Path] | None = None
) -> Outcome:
    """One Codex run in a fresh empty folder. Stop and the time limit end it between events."""
    outcome = Outcome()
    folder = Path(tempfile.mkdtemp(prefix="tawreed-codex-"))
    try:
        process = await asyncio.create_subprocess_exec(
            *command(model, folder, url, images or []),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={**os.environ, TOKEN_VARIABLE: token},
            cwd=folder,
            creationflags=NO_WINDOW,
            limit=16 * 1024 * 1024,  # a single event can be long
        )
        process.stdin.write(prompt.encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()
        deadline = time.monotonic() + RUN_TIME
        while True:
            if stop.is_set() or time.monotonic() > deadline:
                outcome.ended = "stopped" if stop.is_set() else "out_of_time"
                process.kill()
                break
            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=0.5)
            except TimeoutError:
                continue
            if not line:
                break
            _read(line, outcome)
        await process.wait()
        if outcome.ended == "done" and process.returncode != 0 and not outcome.problem:
            outcome.ended, outcome.problem = "failed", "codex_failed"
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    return outcome


def _read(line: bytes, outcome: Outcome) -> None:
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return
    item = event.get("item") or {}
    if event.get("type") == "item.completed" and item.get("type") == "mcp_tool_call":
        failed = item.get("status") != "completed"
        error = item.get("error")
        reason = (error.get("message") if isinstance(error, dict) else error) if failed else None
        sent_back = str(reason or "failed")[:300] if failed else None
        outcome.calls.append({"tool": item.get("tool"), "sent_back": sent_back})
    elif event.get("type") == "turn.completed":
        usage = event.get("usage") or {}
        outcome.input_tokens += int(usage.get("input_tokens") or 0)
        outcome.output_tokens += int(usage.get("output_tokens") or 0)
    elif event.get("type") in ("turn.failed", "error"):
        message = event.get("message") or (event.get("error") or {}).get("message") or ""
        outcome.ended, outcome.problem = "failed", explain(message)


async def check(model: str, url: str, runs: Runs) -> tuple[bool, str | None, bool]:
    """Whether Codex, with this model, calls Tawreed's tools, and whether it reads images."""
    code, number = secrets.token_hex(3), str(secrets.randbelow(900) + 100)
    report = Check()
    token = runs.open(report)
    folder = Path(tempfile.mkdtemp(prefix="tawreed-check-"))
    try:
        image = folder / "number.png"
        image.write_bytes(number_image(number))
        prompt = (
            f"This is a connection check. Call the tawreed tool report_code with the code {code}. "
            "Then read the number written in the attached image and call report_number with it. Then stop."
        )
        outcome = await run(model, prompt, url, token, threading.Event(), [image])
    finally:
        runs.close(token)
        shutil.rmtree(folder, ignore_errors=True)
    if report.code != code:
        return False, outcome.problem or "no_tool_use", False
    return True, None, report.number == number
