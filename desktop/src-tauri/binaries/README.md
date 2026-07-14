# Tawreed engine binaries

`scripts/build_sidecar.py` packages the headless Python engine with PyInstaller
and writes a target-triple-suffixed build payload here. `build.rs` embeds that
payload into the Rust host, so release users receive one direct executable and
never manage a neighboring sidecar file. Generated payloads are intentionally
ignored; CI builds one natively on each target operating system.
