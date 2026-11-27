fn main() {
    // The gix line of Cargo.toml, as the display version: the requested range is what this
    // build means by "gitoxide".
    let manifest = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .expect("read Cargo.toml");
    let version = manifest
        .lines()
        .find_map(|l| l.strip_prefix("gix = \"").map(|v| v.trim_end_matches('"').to_string()))
        .expect("the gix dependency line");
    println!("cargo:rustc-env=GIX_VERSION={version}");
    println!("cargo:rerun-if-changed=Cargo.toml");
}
