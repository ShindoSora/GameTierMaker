# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


project_root = Path(SPECPATH)
xbox_hiddenimports = collect_submodules('xbox')

a = Analysis(
    [str(project_root / 'main.py')],
    pathex=[str(project_root)],
    binaries=[],
    datas=[
        (str(project_root / 'frontend'), 'frontend'),
    ],
    hiddenimports=[
        'webview',
        'webview.platforms.winforms',
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.lifespan.on',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'fastapi',
        'PIL',
        'requests',
        'xbox.webapi.scripts.authenticate',
    ] + xbox_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='GameTierMaker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # Avoid UPX to reduce antivirus false positives for the portable executable.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(project_root / "ico" / "exe.ico"),
    version=None,
)
