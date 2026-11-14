//! Regenerates `schemas/v1/*.json` from the Rust domain types. Run: `cargo run --bin gen_schemas`.
use std::{fs, path::Path};

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../schemas/v1");
    fs::create_dir_all(&dir).expect("create schemas/v1");
    for (name, json) in llm_review_workspace_lib::domain::schema_files() {
        fs::write(dir.join(name), json).expect("write schema");
        println!("wrote schemas/v1/{name}");
    }
}
