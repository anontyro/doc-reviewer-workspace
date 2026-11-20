//! Project, library and draft files (F3 spec D2, D4, D27). All three are rejected if they hold an unknown field, so a
//! file from a newer shape fails closed instead of being half read.
use super::entities::{DocumentFormat, DocumentId, ProjectId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A document the user added to a project. Only added documents are tracked, the folder is never scanned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectDocument {
    /// A single file name in the project root (F3 spec D9). Never an absolute path.
    pub relative_path: String,
    pub format: DocumentFormat,
    pub added_at: String,
}

/// `<project>/.review-workspace/project.json`. Holds no absolute path, so the folder can be moved or synced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectFile {
    pub schema_version: String,
    pub id: ProjectId,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub documents: Vec<ProjectDocument>,
}

/// One remembered project. A cache of what the user opened: `project.json` wins if the name differs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryRecord {
    pub project_id: ProjectId,
    pub name: String,
    pub root_path: String,
    pub last_opened_at: String,
}

/// `<app data>/library.json`. Rebuildable by opening the folders again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryFile {
    pub schema_version: String,
    pub entries: Vec<LibraryRecord>,
}

/// Unsaved editor text, written so a crash does not lose it. `base_hash` is the hash of the file the text was
/// edited from, so restoring it can still detect a file that changed since.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DraftFile {
    pub schema_version: String,
    pub document_id: DocumentId,
    pub base_hash: String,
    pub text: String,
    pub saved_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::schema_version::check_schema_version;
    use serde_json::Value;
    use std::{fs, path::Path};

    fn load(name: &str) -> Vec<(String, String, Value)> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/domain");
        let cases: Vec<Value> =
            serde_json::from_str(&fs::read_to_string(path.join(name)).unwrap()).unwrap();
        cases
            .into_iter()
            .map(|c| {
                (
                    c["name"].as_str().unwrap().to_string(),
                    c["type"].as_str().unwrap().to_string(),
                    c["value"].clone(),
                )
            })
            .collect()
    }

    /// Reads a fixture the way the store will: parse, then check the version.
    fn accepted(kind: &str, value: &Value) -> bool {
        fn go<T: serde::de::DeserializeOwned>(v: &Value, version: impl Fn(&T) -> &str) -> bool {
            serde_json::from_value::<T>(v.clone())
                .map(|t| check_schema_version(version(&t)).is_ok())
                .unwrap_or(false)
        }
        match kind {
            "ProjectFile" => go::<ProjectFile>(value, |t| &t.schema_version),
            "LibraryFile" => go::<LibraryFile>(value, |t| &t.schema_version),
            "DraftFile" => go::<DraftFile>(value, |t| &t.schema_version),
            other => panic!("not a project type: {other}"),
        }
    }

    const NEW: [&str; 3] = ["ProjectFile", "LibraryFile", "DraftFile"];

    #[test]
    fn every_valid_fixture_is_read_and_every_invalid_one_is_refused() {
        for (name, kind, value) in load("valid.json") {
            if NEW.contains(&kind.as_str()) {
                assert!(accepted(&kind, &value), "should accept: {name}");
            }
        }
        for (name, kind, value) in load("invalid.json") {
            if NEW.contains(&kind.as_str()) {
                assert!(!accepted(&kind, &value), "should refuse: {name}");
            }
        }
    }

    /// The JSON schema cannot compare versions, so the reader's version check is what refuses a newer file.
    #[test]
    fn a_newer_major_version_is_refused_for_every_project_type() {
        for (name, kind, value) in load("valid.json") {
            if NEW.contains(&kind.as_str()) {
                let mut newer = value.clone();
                newer["schema_version"] = Value::String("2.0.0".into());
                assert!(!accepted(&kind, &newer), "should refuse 2.0.0: {name}");
            }
        }
    }

    #[test]
    fn a_project_file_has_no_absolute_path_field() {
        let json = serde_json::to_value(ProjectFile {
            schema_version: "1.0.0".into(),
            id: serde_json::from_value(Value::String("proj_0123456789abcdef".into())).unwrap(),
            name: "n".into(),
            created_at: "2026-11-20T10:00:00Z".into(),
            updated_at: "2026-11-20T10:00:00Z".into(),
            documents: vec![],
        })
        .unwrap();
        let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        assert!(!keys.iter().any(|k| k.contains("path") || k == "root"));
    }
}
