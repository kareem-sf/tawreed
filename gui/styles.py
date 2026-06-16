"""Style tokens and stylesheet loader.

The QSS lives in ``gui/themes/tawreed_dark.qss`` (loaded at runtime by
``load_stylesheet()``); the Python constants here are the *single source
of truth* for every color / radius / type value. The ``.qss`` file uses
``@token`` placeholders that are substituted at load time.

Adding a new token:
    1. Add the constant below.
    2. Reference it as ``@my-token`` in the .qss file.
    3. Add it to ``_TOKEN_MAP`` for substitution.

Re-theming:
    Change a constant here. That's it. No .qss edits required for
    recolor, re-space, re-type. Only when adding new selectors.

Legacy alias:
    ``MAIN_WINDOW_STYLE`` and ``SETTINGS_DIALOG_STYLE`` are kept as
    module-level strings so any third-party widget that imports them
    during the deprecation window still works. Both are loaded once at
    import time.
"""

from __future__ import annotations

import os
from functools import lru_cache

# ----- Colour tokens (Catppuccin Mocha-ish, dark) -----
COLOR_BG = "#0d0e15"  # main window background
COLOR_BG_RAIL = "#0a0b12"  # nav rail background
COLOR_BG_CARD = "rgba(20, 21, 33, 0.55)"  # main content card surface (translucent)
COLOR_BG_CARD_ELEV = "rgba(28, 30, 46, 0.7)"  # raised card surface (Card widget)
COLOR_BG_INPUT = "rgba(255, 255, 255, 0.05)"
COLOR_BG_INPUT_FOCUS = "rgba(255, 255, 255, 0.08)"

COLOR_BORDER = "rgba(255, 255, 255, 0.08)"
COLOR_BORDER_INPUT = "rgba(255, 255, 255, 0.10)"
COLOR_BORDER_INPUT_FOCUS = "#89b4fa"

COLOR_TEXT = "#e2e4f3"
COLOR_TEXT_DIM = "#a6adc8"
COLOR_TEXT_MUTED = "#7f849c"
COLOR_TEXT_PRIMARY = "#0d0e15"  # text on top of primary buttons

COLOR_ACCENT = "#89b4fa"  # primary blue
COLOR_ACCENT_HOVER = "#b4befe"
COLOR_ACCENT_TRANS = "rgba(137, 180, 250, 0.08)"
COLOR_ACCENT_TRANS_HOVER = "rgba(137, 180, 250, 0.18)"
COLOR_ACCENT_TRANS_BORDER = "rgba(137, 180, 250, 0.3)"
COLOR_ACCENT_TRANS_BORDER_HOVER = "rgba(137, 180, 250, 0.5)"

# Semantic status colours (Catppuccin Mocha).
COLOR_SUCCESS = "#a6e3a1"  # green
COLOR_WARNING = "#f9e2af"  # yellow
COLOR_ERROR = "#f38ba8"  # red/pink

# ----- Light theme tokens -----
COLOR_BG_LIGHT = "#f8fafc"  # main window background
COLOR_BG_RAIL_LIGHT = "#f1f5f9"  # nav rail background
COLOR_BG_CARD_LIGHT = "#ffffff"  # main content card surface
COLOR_BG_CARD_ELEV_LIGHT = "#ffffff"  # raised card surface
COLOR_BG_INPUT_LIGHT = "#f8fafc"  # input background
COLOR_BG_INPUT_FOCUS_LIGHT = "#f1f5f9"  # input focus background

COLOR_BORDER_LIGHT = "#e2e8f0"  # border color
COLOR_BORDER_INPUT_LIGHT = "#cbd5e1"  # input border
COLOR_BORDER_INPUT_FOCUS_LIGHT = "#89b4fa"  # input focus border

COLOR_TEXT_LIGHT = "#1e293b"  # primary text
COLOR_TEXT_DIM_LIGHT = "#64748b"  # dim text
COLOR_TEXT_MUTED_LIGHT = "#94a3b8"  # muted text
COLOR_TEXT_PRIMARY_LIGHT = "#ffffff"  # text on primary buttons

COLOR_ACCENT_LIGHT = "#3b82f6"  # primary blue (slightly darker for light theme)
COLOR_ACCENT_HOVER_LIGHT = "#2563eb"  # accent hover
COLOR_ACCENT_TRANS_LIGHT = "rgba(59, 130, 246, 0.1)"  # accent transparent
COLOR_ACCENT_TRANS_HOVER_LIGHT = "rgba(59, 130, 246, 0.2)"  # accent transparent hover
COLOR_ACCENT_TRANS_BORDER_LIGHT = "rgba(59, 130, 246, 0.3)"  # accent border
COLOR_ACCENT_TRANS_BORDER_HOVER_LIGHT = "rgba(59, 130, 246, 0.5)"  # accent border hover

# Semantic status colours for light theme
COLOR_SUCCESS_LIGHT = "#22c55e"  # green
COLOR_WARNING_LIGHT = "#f59e0b"  # amber
COLOR_ERROR_LIGHT = "#ef4444"  # red

# Spacing
RADIUS_SM = 6
RADIUS_MD = 8
RADIUS_LG = 10
RADIUS_XL = 16

# Type
TYPE_MONO = "'Consolas', 'Courier New', monospace"
TYPE_SANS = "'Segoe UI', 'Inter', system-ui, sans-serif"


# ----- Theme file location -----

_THEMES_DIR = os.path.join(os.path.dirname(__file__), "themes")
_DARK_THEME_PATH = os.path.join(_THEMES_DIR, "tawreed_dark.qss")
_LIGHT_THEME_PATH = os.path.join(_THEMES_DIR, "tawreed_light.qss")

# Current theme (can be changed at runtime)
_current_theme = "dark"


def set_theme(theme: str) -> None:
    """Set the current theme. Valid values: 'dark', 'light'."""
    global _current_theme
    if theme in ("dark", "light"):
        _current_theme = theme
    else:
        raise ValueError(f"Unknown theme: {theme}. Use 'dark' or 'light'.")


def get_theme() -> str:
    """Get the current theme."""
    return _current_theme


# ----- Token substitution map -----
#
# Maps the @-token names used in tawreed_dark.qss to the Python constants
# above. Hyphens in CSS become underscores when looked up here.
# The token map is dynamically generated based on the current theme.
_TOKEN_MAP_DARK = {
    "color-bg": COLOR_BG,
    "color-bg-rail": COLOR_BG_RAIL,
    "color-bg-card": COLOR_BG_CARD,
    "color-bg-card-elev": COLOR_BG_CARD_ELEV,
    "color-bg-input": COLOR_BG_INPUT,
    "color-bg-input-focus": COLOR_BG_INPUT_FOCUS,
    "color-bg-input-hover": COLOR_BG_INPUT_FOCUS,  # For hover states
    "color-border": COLOR_BORDER,
    "color-border-input": COLOR_BORDER_INPUT,
    "color-border-input-focus": COLOR_BORDER_INPUT_FOCUS,
    "color-text": COLOR_TEXT,
    "color-text-dim": COLOR_TEXT_DIM,
    "color-text-muted": COLOR_TEXT_MUTED,
    "color-text-primary": COLOR_TEXT_PRIMARY,
    "color-accent": COLOR_ACCENT,
    "color-accent-hover": COLOR_ACCENT_HOVER,
    "color-accent-trans": COLOR_ACCENT_TRANS,
    "color-accent-trans-hover": COLOR_ACCENT_TRANS_HOVER,
    "color-accent-trans-border": COLOR_ACCENT_TRANS_BORDER,
    "color-accent-trans-border-hover": COLOR_ACCENT_TRANS_BORDER_HOVER,
    "color-success": COLOR_SUCCESS,
    "color-warning": COLOR_WARNING,
    "color-error": COLOR_ERROR,
    "radius-sm": str(RADIUS_SM),
    "radius-md": str(RADIUS_MD),
    "radius-lg": str(RADIUS_LG),
    "radius-xl": str(RADIUS_XL),
    "type-mono": TYPE_MONO,
}

_TOKEN_MAP_LIGHT = {
    "color-bg": COLOR_BG_LIGHT,
    "color-bg-rail": COLOR_BG_RAIL_LIGHT,
    "color-bg-card": COLOR_BG_CARD_LIGHT,
    "color-bg-card-elev": COLOR_BG_CARD_ELEV_LIGHT,
    "color-bg-input": COLOR_BG_INPUT_LIGHT,
    "color-bg-input-focus": COLOR_BG_INPUT_FOCUS_LIGHT,
    "color-bg-input-hover": COLOR_BG_INPUT_FOCUS_LIGHT,
    "color-border": COLOR_BORDER_LIGHT,
    "color-border-input": COLOR_BORDER_INPUT_LIGHT,
    "color-border-input-focus": COLOR_BORDER_INPUT_FOCUS_LIGHT,
    "color-text": COLOR_TEXT_LIGHT,
    "color-text-dim": COLOR_TEXT_DIM_LIGHT,
    "color-text-muted": COLOR_TEXT_MUTED_LIGHT,
    "color-text-primary": COLOR_TEXT_PRIMARY_LIGHT,
    "color-accent": COLOR_ACCENT_LIGHT,
    "color-accent-hover": COLOR_ACCENT_HOVER_LIGHT,
    "color-accent-trans": COLOR_ACCENT_TRANS_LIGHT,
    "color-accent-trans-hover": COLOR_ACCENT_TRANS_HOVER_LIGHT,
    "color-accent-trans-border": COLOR_ACCENT_TRANS_BORDER_LIGHT,
    "color-accent-trans-border-hover": COLOR_ACCENT_TRANS_BORDER_HOVER_LIGHT,
    "color-success": COLOR_SUCCESS_LIGHT,
    "color-warning": COLOR_WARNING_LIGHT,
    "color-error": COLOR_ERROR_LIGHT,
    "radius-sm": str(RADIUS_SM),
    "radius-md": str(RADIUS_MD),
    "radius-lg": str(RADIUS_LG),
    "radius-xl": str(RADIUS_XL),
    "type-mono": TYPE_MONO,
}


def _get_token_map() -> dict[str, str]:
    """Get the token map for the current theme."""
    if _current_theme == "light":
        return _TOKEN_MAP_LIGHT
    else:
        return _TOKEN_MAP_DARK


@lru_cache(maxsize=4)
def load_stylesheet(theme: str | None = None) -> str:
    """Load the requested theme's QSS with tokens substituted in.

    If ``theme`` is None, uses the current theme set via ``set_theme()``.
    Otherwise, ``theme`` is the bare name of the .qss file in ``gui/themes/``
    (without extension). Supported themes: "dark", "light".

    Returns the fully-substituted QSS string. ``@unknown`` tokens are
    left as-is so a missing token is visible in the rendered output
    rather than silently swallowed.
    """
    # Use provided theme or current theme
    actual_theme = theme if theme is not None else _current_theme
    
    if actual_theme == "dark":
        path = _DARK_THEME_PATH
    elif actual_theme == "light":
        path = _LIGHT_THEME_PATH
    else:
        path = os.path.join(_THEMES_DIR, f"tawreed_{actual_theme}.qss")

    with open(path, encoding="utf-8") as fh:
        raw = fh.read()

    # Get the token map for the current theme
    token_map = _get_token_map() if actual_theme == _current_theme else (
        _TOKEN_MAP_LIGHT if actual_theme == "light" else _TOKEN_MAP_DARK
    )

    def _sub(match: re.Match[str]) -> str:  # type: ignore[name-defined]
        token = match.group(1)
        return token_map.get(token, match.group(0))

    import re

    return re.sub(r"@([a-z0-9-]+)", _sub, raw)


# ----- Legacy compatibility shims -----
#
# Pre-PR-#4 code imported ``MAIN_WINDOW_STYLE`` and
# ``SETTINGS_DIALOG_STYLE`` as module-level strings. We keep them as
# eager-loaded values for one release so any third-party widget that
# still imports them works. They will be removed in a later cleanup PR.
MAIN_WINDOW_STYLE = load_stylesheet("dark")
SETTINGS_DIALOG_STYLE = MAIN_WINDOW_STYLE
