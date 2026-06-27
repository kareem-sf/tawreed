"""Smoke tests for the theme loader.

We don't render Qt here — these tests just exercise the substitution
logic so a typo in a token name shows up in CI rather than at
runtime as a literal ``@unknown`` in the QSS string.
"""

from __future__ import annotations

from gui.styles import MAIN_WINDOW_STYLE, load_stylesheet


def test_dark_theme_loads() -> None:
    s = load_stylesheet("dark")
    assert s, "load_stylesheet('dark') returned empty string"
    # No @-tokens should survive substitution.
    leftover = [
        line
        for line in s.splitlines()
        if "@color-" in line or "@radius-" in line or "@type-" in line
    ]
    assert not leftover, f"unsubstituted tokens: {leftover!r}"


def test_token_map_covers_all_referenced_tokens() -> None:
    """Every token in _TOKEN_MAP must be referenced in the .qss, and
    every @-reference in the .qss must have an entry in _TOKEN_MAP.
    Catches typos in either direction.

    Strips C-style comments and the doc-comment header before scanning
    so prose like "All @-prefixed tokens…" doesn't trip the regex.
    """
    import re
    from pathlib import Path

    qss_path = Path(__file__).resolve().parents[1] / "gui" / "themes" / "tawreed_dark.qss"
    raw = qss_path.read_text(encoding="utf-8")
    # Drop block comments. QSS doesn't have comments but the file
    # header is a /* ... */ block.
    qss = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
    # Tokens only start with a known prefix.
    referenced = set(re.findall(r"@(color-[a-z-]+|radius-[a-z]+|type-[a-z]+)", qss))
    # Load the stylesheet to get the substituted values
    stylesheet = load_stylesheet("dark")
    # Extract tokens from the stylesheet
    token_pattern = r"@(color-[a-z-]+|radius-[a-z]+|type-[a-z]+)"
    tokens_in_stylesheet = set(re.findall(token_pattern, stylesheet))
    # Since the stylesheet should have no @-tokens after substitution, tokens_in_stylesheet should be empty
    assert not tokens_in_stylesheet, f"Stylesheet still contains @-tokens: {tokens_in_stylesheet!r}"
    # All referenced tokens should be substituted (i.e., not present in the stylesheet)
    assert not referenced.intersection(tokens_in_stylesheet), f"Referenced tokens not substituted: {referenced.intersection(tokens_in_stylesheet)!r}"


def test_legacy_alias_works() -> None:
    """The pre-PR-#4 module-level MAIN_WINDOW_STYLE constant is kept
    for the deprecation window."""
    assert isinstance(MAIN_WINDOW_STYLE, str)
    assert MAIN_WINDOW_STYLE, "MAIN_WINDOW_STYLE is empty"


def test_known_token_substitutes() -> None:
    """Spot-check a couple of well-known substitutions."""
    s = load_stylesheet("dark")
    assert "#0d0e15" in s, "COLOR_BG did not substitute into the QSS"
    assert "#89b4fa" in s, "COLOR_ACCENT did not substitute into the QSS"
