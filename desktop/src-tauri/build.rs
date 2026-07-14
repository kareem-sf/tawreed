use std::{env, path::PathBuf};

fn main() {
    let target = env::var("TARGET").expect("Cargo did not provide a target triple");
    let executable_suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let engine = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("Cargo did not provide a manifest directory"),
    )
    .join("binaries")
    .join(format!("tawreed-engine-{target}{executable_suffix}"));

    if !engine.is_file() {
        panic!(
            "portable engine payload is missing at {}; run `python scripts/build_sidecar.py` first",
            engine.display()
        );
    }

    println!("cargo:rerun-if-changed={}", engine.display());
    println!("cargo:rustc-env=TAWREED_ENGINE_BINARY={}", engine.display());
    tauri_build::build()
}
