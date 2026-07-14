"""Headless Tawreed engine used by the Tauri desktop host."""

from core.metadata import __version__
from tawreed_engine.protocol import PROTOCOL_VERSION

__all__ = ["PROTOCOL_VERSION", "__version__"]
