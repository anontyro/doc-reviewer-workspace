use super::anchor::Anchor;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// shortcut: timestamps are plain RFC 3339 UTC strings and are not parsed, so a bad one is not rejected.
// Add `chrono` and validate when persistence lands (F2/F3).

/// Typed id with a fixed prefix (decision 0002). Generating ids belongs to F2.
macro_rules! id_type {
    ($(#[$meta:meta])* $name:ident, $prefix:literal) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
        #[serde(try_from = "String", into = "String")]
        #[schemars(extend("pattern" = concat!("^", $prefix, ".+$")))]
        pub struct $name(String);

        impl TryFrom<String> for $name {
            type Error = String;
            fn try_from(s: String) -> Result<Self, String> {
                if s.len() > $prefix.len() && s.starts_with($prefix) {
                    Ok(Self(s))
                } else {
                    Err(format!("expected an id starting with \"{}\", got \"{s}\"", $prefix))
                }
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.0
            }
        }
    };
}

id_type!(ProjectId, "proj_");
id_type!(DocumentId, "doc_");
id_type!(VersionId, "ver_");
id_type!(RoundId, "rnd_");
id_type!(AnnotationId, "rev_");
id_type!(ExportId, "exp_");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentFormat {
    Markdown,
    Pdf,
}

/// Recommended values (PRD §6.2), not confirmed scope (decision 0002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnnotationAction {
    Comment,
    Replace,
    Remove,
    Expand,
    Question,
    Approve,
}

/// Recommended values (PRD §6.2). Export inclusion is not a status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnnotationStatus {
    Open,
    Resolved,
    Superseded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Document {
    pub schema_version: String,
    pub id: DocumentId,
    pub project_id: ProjectId,
    pub relative_path: String,
    pub format: DocumentFormat,
    pub active_version_id: VersionId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DocumentVersion {
    pub schema_version: String,
    pub id: VersionId,
    pub document_id: DocumentId,
    pub version_number: u32,
    /// sha256 (hex) of the snapshot bytes.
    pub content_hash: String,
    pub snapshot_path: String,
    pub created_at: String,
    /// Free text until F4 (T-011) defines the values. The PRD names the field but not its values.
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReviewRound {
    pub schema_version: String,
    pub id: RoundId,
    pub document_version_id: VersionId,
    /// Free text until F4 (T-011) defines the values. The PRD names the field but not its values.
    pub state: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Annotation {
    pub schema_version: String,
    pub id: AnnotationId,
    pub round_id: RoundId,
    pub action_type: AnnotationAction,
    /// The user's comment, stored and exported verbatim.
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replacement_text: Option<String>,
    pub anchor: Anchor,
    pub status: AnnotationStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExportSnapshot {
    pub schema_version: String,
    pub id: ExportId,
    pub created_at: String,
    /// Free text until F4 (T-012/T-013): copied prompt or review package.
    pub format: String,
    pub document_version_refs: Vec<VersionId>,
    pub annotation_ids: Vec<AnnotationId>,
    pub payload_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_output_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ids_must_carry_their_prefix() {
        assert!(serde_json::from_value::<ProjectId>(json!("proj_001")).is_ok());
        for bad in ["project_001", "doc_001", "proj_", "", "PROJ_1"] {
            assert!(
                serde_json::from_value::<ProjectId>(json!(bad)).is_err(),
                "{bad:?}"
            );
        }
        assert!(serde_json::from_value::<AnnotationId>(json!("rev_014")).is_ok());
        assert!(serde_json::from_value::<AnnotationId>(json!("proj_014")).is_err());
    }

    #[test]
    fn ids_serialise_as_plain_strings() {
        let id: VersionId = serde_json::from_value(json!("ver_002")).unwrap();
        assert_eq!(serde_json::to_value(&id).unwrap(), json!("ver_002"));
    }

    #[test]
    fn unknown_enum_values_are_errors_not_defaults() {
        assert!(serde_json::from_value::<AnnotationAction>(json!("rewrite")).is_err());
        assert!(serde_json::from_value::<AnnotationStatus>(json!("Open")).is_err());
        assert!(serde_json::from_value::<DocumentFormat>(json!("docx")).is_err());
        for a in [
            "comment", "replace", "remove", "expand", "question", "approve",
        ] {
            assert!(
                serde_json::from_value::<AnnotationAction>(json!(a)).is_ok(),
                "{a}"
            );
        }
    }

    fn annotation_json() -> serde_json::Value {
        json!({
            "schema_version": "1.0.0",
            "id": "rev_014",
            "round_id": "rnd_001",
            "action_type": "replace",
            "text": "Remove the external dependency; local auth is enough.",
            "replacement_text": "Local auth is sufficient.",
            "anchor": {
                "exact": "The system must use an external identity broker.",
                "prefix": "Authentication should be straightforward.",
                "suffix": "",
                "heading_path": ["Architecture", "Authentication"],
                "source_hash": "abc",
                "confidence": "resolved"
            },
            "status": "open",
            "created_at": "2026-11-06T00:00:00Z",
            "updated_at": "2026-11-06T00:00:00Z"
        })
    }

    #[test]
    fn annotation_round_trips_and_keeps_user_text_verbatim() {
        let a: Annotation = serde_json::from_value(annotation_json()).unwrap();
        assert_eq!(
            a.text,
            "Remove the external dependency; local auth is enough."
        );
        assert_eq!(serde_json::to_value(&a).unwrap(), annotation_json());
    }

    #[test]
    fn annotation_with_bad_action_or_missing_anchor_is_rejected() {
        let mut bad_action = annotation_json();
        bad_action["action_type"] = json!("rewrite");
        assert!(serde_json::from_value::<Annotation>(bad_action).is_err());
        let mut no_anchor = annotation_json();
        no_anchor.as_object_mut().unwrap().remove("anchor");
        assert!(serde_json::from_value::<Annotation>(no_anchor).is_err());
    }
}
