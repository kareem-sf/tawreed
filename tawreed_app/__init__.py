"""Tawreed package.

Enables ``python -m tawreed`` after ``pip install -e .`` (or
unmodified source checkout).
"""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("tawreed")
except PackageNotFoundError:  # source checkout before installation
    __version__ = "0.0.12"
__appname__ = "Tawreed"
__author__ = "Kareem Safwat"
__author_url__ = "https://kareemsafwat.com"
__license__ = "MIT"
__repo_url__ = "https://github.com/sfkareem/tawreed"
