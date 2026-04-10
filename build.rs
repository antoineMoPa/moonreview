use std::{env, path::Path, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=web/src");
    println!("cargo:rerun-if-changed=web/build.mjs");
    println!("cargo:rerun-if-changed=package.json");
    println!("cargo:rerun-if-changed=package-lock.json");
    println!("cargo:rerun-if-changed=tsconfig.json");

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("missing manifest dir");
    let dist_file = Path::new(&manifest_dir).join("web/dist/app.js");

    let install_status = Command::new("npm")
        .arg("install")
        .current_dir(&manifest_dir)
        .status()
        .expect("failed to run npm install");
    assert!(install_status.success(), "npm install failed");

    let build_status = Command::new("npm")
        .args(["run", "build"])
        .current_dir(&manifest_dir)
        .status()
        .expect("failed to run npm run build");
    assert!(build_status.success(), "npm run build failed");

    assert!(dist_file.exists(), "expected bundled frontend at web/dist/app.js");
}
