use super::atomic::write_atomic;
use crate::document::{CommandError, ErrorKind, OpenedDocument};
use crate::domain::anchor::{Anchor, AnchorConfidence};
use crate::domain::entities::{
    Annotation, AnnotationAction, AnnotationId, AnnotationStatus, RoundId,
};
use crate::domain::schema_version::{check_schema_version, CURRENT_SCHEMA_VERSION};
use crate::domain::store::AnnotationFile;
use crate::markdown::{resolve_anchor, ResolvedAnchor};
use serde::Serialize;
use std::{fs, io::ErrorKind as IoKind, path::PathBuf, sync::Mutex};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// An annotation plus how it stands against the open text now (F2 spec D20).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AnnotationView {
    pub annotation: Annotation,
    /// A fresh resolution of the stored quote and context against the open file. Nothing is saved from it.
    pub current: ResolvedAnchor,
    /// The stored `source_hash` differs from the open file's hash.
    pub stale: bool,
}

/// How a stored annotation stands against the text of the open file now.
pub fn view(source: &str, source_hash: &str, annotation: Annotation) -> AnnotationView {
    AnnotationView {
        current: resolve_anchor(
            source,
            &annotation.anchor.exact,
            &annotation.anchor.prefix,
            &annotation.anchor.suffix,
        ),
        stale: annotation.anchor.source_hash != source_hash,
        annotation,
    }
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

pub struct Store {
    dir: PathBuf,
    // One writer at a time, so two commands cannot read the same file and lose one another's change.
    lock: Mutex<()>,
}

fn io(msg: impl std::fmt::Display) -> CommandError {
    CommandError::new(ErrorKind::Io, msg.to_string())
}

fn invalid(msg: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::Invalid, msg)
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            lock: Mutex::new(()),
        }
    }

    fn file_path(&self, doc: &OpenedDocument) -> PathBuf {
        let id = serde_json::to_value(&doc.document_id)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        self.dir.join(format!("{id}.json"))
    }

    /// Reads the document's file. A missing file is an empty one. An unreadable, newer or foreign file is an error,
    /// and is never overwritten (F2 spec D16).
    fn load(&self, doc: &OpenedDocument) -> Result<AnnotationFile, CommandError> {
        let path = self.file_path(doc);
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == IoKind::NotFound => {
                return Ok(AnnotationFile {
                    schema_version: CURRENT_SCHEMA_VERSION.to_string(),
                    document_id: doc.document_id.clone(),
                    path: doc.path.clone(),
                    next_sequence: 1,
                    annotations: vec![],
                })
            }
            Err(e) => return Err(io(format!("cannot read the comments file: {e}"))),
        };
        let unreadable = |why: String| {
            io(format!(
                "the comments file {} is unusable: {why}",
                path.display()
            ))
        };
        // Check the version on its own first, so a newer file is refused even if its shape has changed.
        let raw: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| unreadable(e.to_string()))?;
        let version = raw
            .get("schema_version")
            .and_then(|v| v.as_str())
            .ok_or_else(|| unreadable("no schema_version".into()))?;
        check_schema_version(version).map_err(|e| unreadable(format!("{e:?}")))?;
        let file: AnnotationFile =
            serde_json::from_value(raw).map_err(|e| unreadable(e.to_string()))?;
        if file.document_id != doc.document_id {
            return Err(unreadable("it belongs to a different document".into()));
        }
        Ok(file)
    }

    fn save(&self, doc: &OpenedDocument, mut file: AnnotationFile) -> Result<(), CommandError> {
        file.path = doc.path.clone();
        let mut json = serde_json::to_string_pretty(&file).map_err(io)?;
        json.push('\n');
        fs::create_dir_all(&self.dir).map_err(io)?;
        write_atomic(&self.file_path(doc), json.as_bytes())
            .map_err(|e| io(format!("could not save comments: {e}")))
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, ()>, CommandError> {
        self.lock
            .lock()
            .map_err(|_| io("comment store is unavailable"))
    }

    /// Resolves the selection against the open text itself and saves a comment only if it is `resolved`.
    pub fn create(
        &self,
        doc: &OpenedDocument,
        selected: &str,
        prefix: &str,
        suffix: &str,
        text: &str,
        now: &str,
    ) -> Result<Annotation, CommandError> {
        if text.trim().is_empty() {
            return Err(invalid("a comment cannot be empty"));
        }
        let r = resolve_anchor(&doc.source, selected, prefix, suffix);
        match r.confidence {
            AnchorConfidence::Resolved => {}
            AnchorConfidence::Ambiguous => {
                return Err(invalid(format!(
                    "the selection matches {} places, select more text",
                    r.candidates
                )))
            }
            AnchorConfidence::Orphaned => {
                return Err(invalid("the selected text was not found in the document"))
            }
        }
        let _guard = self.locked()?;
        let mut file = self.load(doc)?;
        let seq = file.next_sequence;
        let annotation = Annotation {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            id: AnnotationId::try_from(format!("rev_{seq:04}")).map_err(invalid)?,
            round_id: RoundId::try_from("rnd_0001".to_string()).map_err(invalid)?,
            action_type: AnnotationAction::Comment,
            text: text.to_string(),
            replacement_text: None,
            anchor: Anchor {
                exact: selected.to_string(),
                prefix: prefix.to_string(),
                suffix: suffix.to_string(),
                heading_path: r.heading_path.unwrap_or_default(),
                source_range: r.source_range,
                source_hash: doc.source_hash.clone(),
                confidence: AnchorConfidence::Resolved,
            },
            status: AnnotationStatus::Open,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        };
        file.annotations.push(annotation.clone());
        file.next_sequence = seq + 1;
        self.save(doc, file)?;
        Ok(annotation)
    }

    pub fn list(&self, doc: &OpenedDocument) -> Result<Vec<AnnotationView>, CommandError> {
        let _guard = self.locked()?;
        Ok(self
            .load(doc)?
            .annotations
            .into_iter()
            .map(|annotation| view(&doc.source, &doc.source_hash, annotation))
            .collect())
    }

    pub fn update(
        &self,
        doc: &OpenedDocument,
        id: &str,
        text: &str,
        now: &str,
    ) -> Result<Annotation, CommandError> {
        if text.trim().is_empty() {
            return Err(invalid("a comment cannot be empty"));
        }
        let _guard = self.locked()?;
        let mut file = self.load(doc)?;
        let a = find(&mut file, id)?;
        a.text = text.to_string();
        a.updated_at = now.to_string();
        let updated = a.clone();
        self.save(doc, file)?;
        Ok(updated)
    }

    pub fn delete(&self, doc: &OpenedDocument, id: &str) -> Result<(), CommandError> {
        let _guard = self.locked()?;
        let mut file = self.load(doc)?;
        find(&mut file, id)?;
        file.annotations
            .retain(|a| String::from(a.id.clone()) != id);
        self.save(doc, file)
    }
}

fn find<'a>(file: &'a mut AnnotationFile, id: &str) -> Result<&'a mut Annotation, CommandError> {
    file.annotations
        .iter_mut()
        .find(|a| String::from(a.id.clone()) == id)
        .ok_or_else(|| invalid(format!("no comment {id}")))
}
