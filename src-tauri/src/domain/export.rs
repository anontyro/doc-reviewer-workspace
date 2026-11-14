use super::anchor::AnchorConfidence;
use super::entities::{
    AnnotationAction, AnnotationId, AnnotationStatus, DocumentId, ExportId, ProjectId, VersionId,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Target kind in the manifest. Only text quotes exist until PDF support (F5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    TextQuote,
}

/// Line numbers are generated against the exact exported version and are never the sole identity (PRD §6.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ManifestTarget {
    #[serde(rename = "type")]
    pub kind: TargetKind,
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
    pub heading_path: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_line_start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_line_end: Option<u32>,
    pub confidence: AnchorConfidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ManifestAnnotation {
    pub id: AnnotationId,
    pub action: AnnotationAction,
    pub status: AnnotationStatus,
    /// The user's comment, verbatim.
    pub user_instruction: String,
    pub target: ManifestTarget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ManifestDocument {
    pub document_id: DocumentId,
    pub version_id: VersionId,
    pub relative_path: String,
    /// sha256 (hex) of the exported source bytes.
    pub sha256: String,
    pub annotations: Vec<ManifestAnnotation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExportManifest {
    pub schema_version: String,
    pub export_id: ExportId,
    pub project_id: ProjectId,
    pub created_at: String,
    pub documents: Vec<ManifestDocument>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    /// PRD §7.3 example with prefixed ids (`proj_`, not `project_`) and a real digest.
    fn sample() -> serde_json::Value {
        let source = b"# Architecture\n\n## Authentication\n\nThe system must use an external identity broker.\n";
        json!({
            "schema_version": "1.0.0",
            "export_id": "exp_001",
            "project_id": "proj_001",
            "created_at": "2026-11-06T00:00:00Z",
            "documents": [{
                "document_id": "doc_001",
                "version_id": "ver_002",
                "relative_path": "product-requirements.md",
                "sha256": Sha256::digest(source).iter().map(|b| format!("{b:02x}")).collect::<String>(),
                "annotations": [{
                    "id": "rev_014",
                    "action": "replace",
                    "status": "open",
                    "user_instruction": "Remove the external dependency; local auth is enough.",
                    "target": {
                        "type": "text_quote",
                        "exact": "The system must use an external identity broker.",
                        "prefix": "Authentication should be straightforward.",
                        "suffix": "",
                        "heading_path": ["Architecture", "Authentication"],
                        "source_line_start": 128,
                        "source_line_end": 134,
                        "confidence": "resolved"
                    }
                }]
            }]
        })
    }

    #[test]
    fn manifest_round_trips_unchanged() {
        let manifest: ExportManifest = serde_json::from_value(sample()).unwrap();
        assert_eq!(manifest.documents[0].sha256.len(), 64);
        assert_eq!(serde_json::to_value(&manifest).unwrap(), sample());
    }

    #[test]
    fn manifest_rejects_unknown_target_type_and_wrong_id_prefix() {
        let mut bad_type = sample();
        bad_type["documents"][0]["annotations"][0]["target"]["type"] = json!("pdf_region");
        assert!(serde_json::from_value::<ExportManifest>(bad_type).is_err());
        let mut bad_id = sample();
        bad_id["project_id"] = json!("project_001");
        assert!(serde_json::from_value::<ExportManifest>(bad_id).is_err());
    }
}
