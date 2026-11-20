use super::entities::{Annotation, DocumentId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The one file that holds every comment on a document (F2 spec D15). F3 may replace it with project storage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AnnotationFile {
    pub schema_version: String,
    pub document_id: DocumentId,
    /// Path the document had when last saved. Informational only: identity is `document_id`.
    pub path: String,
    /// Next `rev_NNNN` sequence number. It only grows, so a deleted id is never reused (F2 spec D17).
    pub next_sequence: u32,
    pub annotations: Vec<Annotation>,
}
