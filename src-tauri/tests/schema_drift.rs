//! Fails if a committed schema differs from what the Rust types generate now.
use std::{fs, path::Path};

#[test]
fn committed_schemas_match_generated_output() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../schemas/v1");
    for (name, generated) in llm_review_workspace_lib::domain::schema_files() {
        let committed = fs::read_to_string(dir.join(name)).unwrap_or_else(|_| {
            panic!("schemas/v1/{name} is missing; run `cargo run --bin gen_schemas`")
        });
        assert_eq!(
            committed, generated,
            "schemas/v1/{name} is stale; run `cargo run --bin gen_schemas`"
        );
    }
}
