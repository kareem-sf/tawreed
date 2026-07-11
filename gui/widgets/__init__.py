"""GUI widget primitives.

Exports the shared page, settings, and navigation primitives.
"""

from .chrome import PageHeader, PageScaffold, SettingsSection
from .navigation import NavigationRail

__all__ = ["NavigationRail", "PageHeader", "PageScaffold", "SettingsSection"]
