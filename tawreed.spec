# -*- mode: python ; coding: utf-8 -*-
#
# Tawreed — PyInstaller spec, onefile build with dead-weight trimming.
#
# Why onefile (vs onedir)?
#   The previous v0.0.1 shipped onedir, which meant the user
#   unzipped a 60+ MB archive and saw a ``_internal/`` folder full
#   of 81 files. For a desktop app the user double-clicks, that's a
#   terrible first impression. Onefile packages the bootloader +
#   every dependency into a single ``Tawreed.exe`` that the user
#   drops anywhere. Cold start is ~12s on a cold cache vs ~1.5s for
#   onedir, but for an internal BOQ-analysis tool that gets opened
#   a few times a day, the UX win is worth the 10s.
#
# Why the long excludes list?
#   The untrimmed onedir build was 188 MB. ~70 MB of that was
#   PySide6 modules the app never imports (QtQuick, QtPdf, QtSvg,
#   the OpenGL software fallback, the full Qt translation pack,
#   the Win32 API forwarder DLLs). PyInstaller's static analysis
#   pulls in everything in site-packages, including the Qt
#   submodules we don't need. The ``excludes=`` and the
#   ``excludes_binaries=`` lists below remove them.
#
# Build (clean ephemeral venv, see .github/workflows/release.yml):
#     uv venv --python 3.11 .venv-build
#     .venv-build/Scripts/activate  # or  source .venv-build/bin/activate
#     pip install -e ".[dev]"
#     pyinstaller tawreed.spec
#
# Output:
#     dist/Tawreed.exe       (single binary, ~50 MB after trims)
#

block_cipher = None

# Hidden imports for modules PyInstaller's static analyser can
# miss because they are dynamically imported (e.g. inside a
# function, or behind a runtime check).
HIDDEN_IMPORTS = [
    # Third-party
    "openpyxl",
    "openai",
    "qasync",
    "keyring",
    "keyring.backends",
    # Project packages — gui/ has dynamic imports via getattr in
    # the navigation shell, and core/ has modules that PyInstaller
    # can miss when they're imported lazily for i18n / logging.
    "gui",
    "gui.pages",
    "gui.pages.workspace_page",
    "gui.pages.history_page",
    "gui.pages.settings_page",
    "gui.pages.about_page",
    "gui.splash",
    "gui.single_app",
    "gui.widgets",
    "gui.widgets.chrome",
    "tawreed_app",
    "tawreed_app.__main__",
    "core",
    "core.ai",
    "core.db",
    "core.excel",
    "core.i18n",
    "core.logging_setup",
    "core.model_catalog",
    "core.reset",
    # Optional LLM SDKs (Anthropic is implemented via raw httpx in
    # core/ai.py; Google Gemini goes through the OpenAI-compat
    # endpoint, so no SDK is needed at runtime).
    # 'anthropic',
    # 'google.generativeai',
]

# Modules to exclude from the analysis (and from the resulting
# .pkg archive). These are PySide6 submodules the app does NOT
# import — confirmed by grepping the source for any reference.
EXCLUDES = [
    # Big Qt modules we never use.
    "PySide6.QtQml",
    "PySide6.QtQuick",
    "PySide6.QtQuickWidgets",
    "PySide6.QtPdf",
    "PySide6.QtPdfWidgets",
    "PySide6.QtWebEngineCore",
    "PySide6.QtWebEngineWidgets",
    "PySide6.QtWebChannel",
    "PySide6.QtMultimedia",
    "PySide6.QtMultimediaWidgets",
    "PySide6.Qt3DCore",
    "PySide6.Qt3DRender",
    "PySide6.QtCharts",
    "PySide6.QtDataVisualization",
    "PySide6.QtScxml",
    "PySide6.QtSensors",
    "PySide6.QtSerialPort",
    "PySide6.QtTest",
    "PySide6.QtBluetooth",
    "PySide6.QtPositioning",
    "PySide6.QtNfc",
    "PySide6.QtLocation",
    "PySide6.QtSql",
    "PySide6.QtXml",
    # We do use QtNetwork (QLocalServer for single-instance), so
    # don't exclude it.
    # Stdlib we don't need.
    "tkinter",
    "unittest",
    "unittest.mock",
    "test",
    "tests",
    "pytest",
    "setuptools._distutils",
    "pkg_resources",
    # Transitive heavyweights that PyInstaller pulls in by
    # default but we never use. None of these are declared
    # dependencies in pyproject.toml — they only appear in the
    # bundle because some site-packages they live next to are
    # transitively required.
    "numpy",
    "pandas",
    "PIL",
    "Pillow",
    "matplotlib",
    "scipy",
    "IPython",
    "notebook",
    "jupyter",
]

# Binary-level excludes (DLLs / .pyd / .so) that ship with
# PySide6 but our app doesn't need. Each entry is a substring
# match against the binary's name; matching binaries are
# dropped from the final COLLECT step.
EXCLUDES_BINARIES = [
    "opengl32sw.dll",       # 20 MB software-OpenGL fallback we don't use
    "Qt6Quick.dll",
    "Qt6Qml.dll",
    "Qt6QmlModels.dll",
    "Qt6Pdf.dll",
    "Qt6Svg.dll",
    "Qt6SvgWidgets.dll",
    "Qt6WebEngineCore.dll",
    "Qt6WebEngineWidgets.dll",
    "Qt6Multimedia.dll",
    "Qt6MultimediaWidgets.dll",
    "Qt63DCore.dll",
    "Qt6Charts.dll",
    "Qt6Test.dll",
    "Qt6VirtualKeyboard.dll",
    "Qt6Sensors.dll",
    "Qt6SerialPort.dll",
    "Qt6Sql.dll",
    "Qt6Positioning.dll",
    "Qt6Nfc.dll",
    "Qt6Location.dll",
    "Qt6Scxml.dll",
    "Qt6Xml.dll",
    "Qt6Bluetooth.dll",
    "Qt63DRender.dll",
    "Qt63DExtras.dll",
    "Qt63DInput.dll",
    "Qt63DLogic.dll",
    "Qt63DAnimation.dll",
    "Qt6DataVisualization.dll",
    "Qt6Gamepad.dll",
    "Qt6Purchasing.dll",
    "Qt6RemoteObjects.dll",
    "Qt6WebSockets.dll",
    "Qt6NetworkAuth.dll",
    "Qt6Designer.dll",
    "Qt6Help.dll",
    "Qt6OpenGL.dll",
    # Note: keep Qt6Core, Qt6Gui, Qt6Widgets, Qt6Network —
    # those are used.
]

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[
        # Logo assets — APP_ICON_PATH (ICO) is used by
        # QApplication.setWindowIcon so the title bar / taskbar /
        # Alt-Tab show the brand icon. The PNG is used by the
        # nav rail / splash.
        ("tawreed_logo.ico", "."),
        ("tawreed_logo_transparent.png", "."),
        # Theme files — loaded at runtime by gui.styles.load_stylesheet.
        ("gui/themes", "gui/themes"),
    ],
    hiddenimports=HIDDEN_IMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDES,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Strip the heavy Qt binaries we don't need. PyInstaller's
# static analysis can pull in Qt6Quick.dll, opengl32sw.dll, etc.
# even though our code never imports them, because PySide6's
# __init__ registers them. This filter passes through the
# analysis output and removes the ones on the exclude list.
a.binaries = [
    b for b in a.binaries if not any(x in b[0] for x in EXCLUDES_BINARIES)
]

# Same for the .zip-data archive: drop translation .qm files
# for languages we don't ship. We support English + Arabic only,
# so anything else is dead weight.
_KEEP_QT_TRANSLATIONS = ("qt_en", "qt_ar")
a.datas = [
    d
    for d in a.datas
    if not (
        # drop the bulk of the Qt translations folder
        isinstance(d[0], str)
        and d[0].startswith("PySide6/translations/")
        and not any(
            d[0].startswith(f"PySide6/translations/{keep}_") for keep in _KEEP_QT_TRANSLATIONS
        )
    )
]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Onefile: a single ``Tawreed.exe`` that the user can drop
# anywhere. The bootloader extracts the rest of the bundle to
# %TEMP% on each launch (slow first launch, fast subsequent).
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="Tawreed",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[
        # UPX breaks some Qt DLL signatures and some of the
        # PyInstaller bootloader stubs. Skip the ones we know
        # are sensitive.
        "Qt6Core.dll",
        "Qt6Gui.dll",
        "Qt6Widgets.dll",
        "python311.dll",
        "libcrypto-3-x64.dll",
        "libssl-3-x64.dll",
    ],
    runtime_tmpdir=None,
    console=False,  # Release: no console window.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=["tawreed_logo.ico"],
    # Filter out the heavy Qt binaries we don't need. PyInstaller
    # matches these against the full path; a substring match
    # against the filename is enough.
    exclude_binaries=False,  # onefile: binaries go IN the EXE
)
