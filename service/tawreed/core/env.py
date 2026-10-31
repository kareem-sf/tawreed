"""The environment Tawreed gives the programs it starts."""

import os
import subprocess
import sys
import webbrowser


def child_env(extra: dict[str, str] | None = None, drop: tuple[str, ...] = ()) -> dict[str, str]:
    """The service's environment for a program it starts (xdg-open, a browser, Codex). A service frozen with
    PyInstaller points LD_LIBRARY_PATH at its own bundled libraries; another program must not load those, so the
    variable goes back to what it was (LD_LIBRARY_PATH_ORIG) or is removed.
    See https://pyinstaller.org/en/stable/runtime-information.html"""
    env = {k: v for k, v in os.environ.items() if k not in drop}
    if getattr(sys, "frozen", False):
        original = env.pop("LD_LIBRARY_PATH_ORIG", None)
        if original is not None:
            env["LD_LIBRARY_PATH"] = original
        else:
            env.pop("LD_LIBRARY_PATH", None)
    env.update(extra or {})
    return env


def open_url(url: str) -> None:
    """Show a web address in the engineer's browser. webbrowser starts the program with this process's own
    environment, so in the frozen Linux service it is started here with the one the program expects."""
    if sys.platform.startswith("linux") and getattr(sys, "frozen", False):
        subprocess.Popen(["xdg-open", url], env=child_env(), stdin=subprocess.DEVNULL)  # noqa: S603, S607
    else:
        webbrowser.open(url)
