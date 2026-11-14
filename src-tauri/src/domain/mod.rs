//! Persisted domain model. Rust is canonical: JSON Schemas and TS types are generated from these (decision 0002).

pub mod anchor;
pub mod entities;
pub mod export;
pub mod schema_version;

use entities::{
    Annotation, Document, DocumentVersion, ExportSnapshot, LibraryEntry, Project, ReviewRound,
};
use schemars::{schema_for, JsonSchema};

/// Root used only to emit one schema holding every entity under `$defs`. Never serialised.
#[derive(JsonSchema)]
#[allow(dead_code)]
struct DomainSchemas {
    project: Project,
    document: Document,
    document_version: DocumentVersion,
    review_round: ReviewRound,
    annotation: Annotation,
    export_snapshot: ExportSnapshot,
    library_entry: LibraryEntry,
}

/// `(file name under schemas/v1, pretty JSON)` for every generated schema.
/// Shared by the `gen_schemas` binary and the drift test so they cannot disagree.
pub fn schema_files() -> Vec<(&'static str, String)> {
    let render = |schema| serde_json::to_string_pretty(&schema).expect("schema serialises") + "\n";
    vec![
        ("domain.schema.json", render(schema_for!(DomainSchemas))),
        (
            "export-manifest.schema.json",
            render(schema_for!(export::ExportManifest)),
        ),
    ]
}
