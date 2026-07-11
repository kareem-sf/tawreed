"""Semantic palette and QSS loader for Light, Dark, and System modes."""

from __future__ import annotations

import os
import re
from functools import lru_cache

from PySide6.QtGui import QGuiApplication, QPalette
from PySide6.QtWidgets import QApplication, QStyle

RADIUS_SM = 6
RADIUS_MD = 10
RADIUS_LG = 14
TYPE_MONO = "'Cascadia Mono', 'Consolas', monospace"

_THEME_PATH = os.path.join(os.path.dirname(__file__), "themes", "tawreed_dark.qss")
_current_theme = "system"

_DARK = {
    "color-bg": "#0b0d12",
    "color-bg-rail": "#101319",
    "color-bg-card": "#141820",
    "color-bg-card-elev": "#1b2029",
    "color-bg-input": "#11151c",
    "color-bg-input-focus": "#18202a",
    "color-border": "#252b35",
    "color-border-input": "#37404d",
    "color-border-input-focus": "#76a9ff",
    "color-text": "#f2f4f8",
    "color-text-dim": "#b4bbc7",
    "color-text-muted": "#9098a6",
    "color-text-primary": "#0b1628",
    "color-accent": "#89b4fa",
    "color-accent-hover": "#a8c7fa",
    "color-accent-trans": "rgba(138, 180, 248, 0.10)",
    "color-accent-trans-hover": "rgba(138, 180, 248, 0.18)",
    "color-accent-trans-border": "rgba(138, 180, 248, 0.45)",
    "color-accent-trans-border-hover": "rgba(138, 180, 248, 0.72)",
    "color-success": "#65c978",
    "color-warning": "#f6bd60",
    "color-error": "#ff7b84",
}

_LIGHT = {
    "color-bg": "#ffffff",
    "color-bg-rail": "#ffffff",
    "color-bg-card": "#ffffff",
    "color-bg-card-elev": "#f6f8fc",
    "color-bg-input": "#ffffff",
    "color-bg-input-focus": "#f7faff",
    "color-border": "#dce2ea",
    "color-border-input": "#b8c2cf",
    "color-border-input-focus": "#075fc7",
    "color-text": "#101722",
    "color-text-dim": "#4b5666",
    "color-text-muted": "#667284",
    "color-text-primary": "#ffffff",
    "color-accent": "#0b63ce",
    "color-accent-hover": "#084faa",
    "color-accent-trans": "rgba(11, 99, 206, 0.08)",
    "color-accent-trans-hover": "rgba(11, 99, 206, 0.14)",
    "color-accent-trans-border": "rgba(11, 99, 206, 0.42)",
    "color-accent-trans-border-hover": "rgba(11, 99, 206, 0.70)",
    "color-success": "#16803c",
    "color-warning": "#9a5b00",
    "color-error": "#b4232f",
}


def set_theme(theme: str) -> None:
    global _current_theme
    if theme not in {"system", "light", "dark"}:
        raise ValueError(f"Unknown theme: {theme}")
    _current_theme = theme
    load_stylesheet.cache_clear()


def get_theme() -> str:
    return _current_theme


def refresh_system_theme() -> None:
    """Invalidate cached System colors after an OS palette change."""
    load_stylesheet.cache_clear()


def motion_enabled() -> bool:
    """Respect OS animation preferences and an explicit accessibility override."""
    if os.environ.get("TAWREED_REDUCED_MOTION", "").casefold() in {"1", "true", "yes"}:
        return False
    app = QApplication.instance()
    return bool(app and app.style().styleHint(QStyle.SH_Widget_Animate))


def _rgba(color, alpha: float) -> str:
    return f"rgba({color.red()}, {color.green()}, {color.blue()}, {alpha:.2f})"


def _system_tokens() -> dict[str, str]:
    app = QGuiApplication.instance()
    palette = app.palette() if app else QPalette()
    window = palette.color(QPalette.Window)
    base = palette.color(QPalette.Base)
    alternate = palette.color(QPalette.AlternateBase)
    # Some Windows palettes expose an inverse AlternateBase (black while the
    # rest of the system palette is light, or vice versa). Using that value as
    # an elevated surface creates a solid black/white control. Keep System mode
    # native, but derive a nearby surface when the alternate color is clearly
    # from the opposite luminance family.
    if abs(alternate.lightnessF() - base.lightnessF()) > 0.35:
        alternate = base.lighter(112) if base.lightnessF() < 0.5 else base.darker(104)
    text = palette.color(QPalette.WindowText)
    muted = palette.color(QPalette.PlaceholderText)
    border = palette.color(QPalette.Mid)
    accent = palette.color(QPalette.Highlight)
    highlighted = palette.color(QPalette.HighlightedText)
    high_contrast = (
        abs(window.lightnessF() - text.lightnessF()) > 0.85
        and (window.lightnessF() < 0.04 or window.lightnessF() > 0.98)
        and accent.saturationF() > 0.55
        and abs(window.lightnessF() - accent.lightnessF()) > 0.28
    )
    if not high_contrast:
        # System follows the OS light/dark preference while retaining Tawreed's
        # deliberate white/dark surfaces instead of Windows' utility-gray
        # widget palette. High Contrast remains fully palette-driven below.
        return dict(_DARK if window.lightnessF() < 0.5 else _LIGHT)
    return {
        "color-bg": window.name(),
        "color-bg-rail": window.name(),
        "color-bg-card": base.name(),
        "color-bg-card-elev": alternate.name(),
        "color-bg-input": base.name(),
        "color-bg-input-focus": alternate.name(),
        "color-border": border.name(),
        "color-border-input": border.name(),
        "color-border-input-focus": accent.name(),
        "color-text": text.name(),
        "color-text-dim": muted.name(),
        "color-text-muted": muted.name(),
        "color-text-primary": highlighted.name(),
        "color-accent": accent.name(),
        "color-accent-hover": accent.lighter(112).name(),
        "color-accent-trans": _rgba(accent, 0.08),
        "color-accent-trans-hover": _rgba(accent, 0.14),
        "color-accent-trans-border": _rgba(accent, 0.45),
        "color-accent-trans-border-hover": _rgba(accent, 0.72),
        # System mode prioritizes the OS-selected contrast colors. Icons and
        # text still communicate semantics when High Contrast removes color.
        "color-success": text.name(),
        "color-warning": text.name(),
        "color-error": text.name(),
    }


def _tokens(theme: str) -> dict[str, str]:
    colors = _system_tokens() if theme == "system" else dict(_LIGHT if theme == "light" else _DARK)
    colors.update(
        {
            "radius-sm": f"{RADIUS_SM}px",
            "radius-md": f"{RADIUS_MD}px",
            "radius-lg": f"{RADIUS_LG}px",
            "radius-xl": f"{RADIUS_LG}px",
            "type-mono": TYPE_MONO,
        }
    )
    return colors


@lru_cache(maxsize=4)
def load_stylesheet(theme: str | None = None) -> str:
    actual = theme or _current_theme
    if actual not in {"system", "light", "dark"}:
        raise ValueError(f"Unknown theme: {actual}")
    with open(_THEME_PATH, encoding="utf-8") as handle:
        raw = handle.read()
    token_map = _tokens(actual)
    return re.sub(
        r"@([a-z0-9-]+)",
        lambda match: token_map.get(match.group(1), match.group(0)),
        raw,
    )


# Compatibility names retained for external imports.
_TOKEN_MAP = {
    **_DARK,
    "radius-sm": "5px",
    "radius-md": "8px",
    "radius-lg": "12px",
    "radius-xl": "12px",
    "type-mono": TYPE_MONO,
}
MAIN_WINDOW_STYLE = load_stylesheet("dark")
SETTINGS_DIALOG_STYLE = MAIN_WINDOW_STYLE
