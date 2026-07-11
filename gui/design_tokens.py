"""Single source of truth for Tawreed's layout geometry."""

from __future__ import annotations


class Spacing:
    XXS = 4
    XS = 8
    SM = 12
    MD = 16
    LG = 24
    XL = 32
    XXL = 48


class Layout:
    NAV_RAIL_WIDTH = 220
    PAGE_GUTTER = 48
    PAGE_TOP = 56
    CONTENT_MAX = 1040
    RUNS_MAX = 1120
    WORKBENCH_DROP_WIDTH = 720
    WORKBENCH_DROP_HEIGHT = 168
    CONTROL_HEIGHT = 42
    BUTTON_HEIGHT = 40
    NAV_ITEM_HEIGHT = 52


class Radius:
    CONTROL = 8
    DROP_ZONE = 12


__all__ = ["Layout", "Radius", "Spacing"]
