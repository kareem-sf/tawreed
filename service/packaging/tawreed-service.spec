# PyInstaller: the Tawreed service as one folder (tawreed-service/), which the desktop installer ships and starts.
# Build with `npm run package:service` from the repository root.

from pathlib import Path

from PyInstaller.utils.hooks import copy_metadata

SERVICE = Path(SPECPATH).parent

# Tawreed imports an AI provider's module only when a connection uses it, so name them for the build.
PROVIDERS = ["anthropic", "openai", "google", "xai"]
hidden = [f"pydantic_ai.models.{p}" for p in PROVIDERS] + [f"pydantic_ai.providers.{p}" for p in PROVIDERS]

a = Analysis(
    [str(Path(SPECPATH) / "entry.py")],
    pathex=[str(SERVICE)],
    hiddenimports=hidden,
    # Alembic reads the migration scripts from disk, so they ship as files beside the frozen modules. Several
    # libraries read their own package metadata when imported, so every dependency's metadata ships too.
    datas=[(str(SERVICE / "tawreed" / "migrations"), "tawreed/migrations"), *copy_metadata("tawreed", recursive=True)],
    excludes=["tkinter", "pytest", "ruff"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="tawreed-service",
    console=True,  # started hidden by the desktop app; a console keeps its log readable when run by hand
    icon=str(SERVICE.parent / "desktop" / "icons" / "icon.ico"),
)
coll = COLLECT(exe, a.binaries, a.datas, name="tawreed-service")
