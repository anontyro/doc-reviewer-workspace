use super::atomic::{read_versioned_json, write_atomic};
use crate::document::{CommandError, ErrorKind, OpenedDocument, Scope};
use crate::domain::anchor::{Anchor, AnchorConfidence};
use crate::domain::entities::{
    Annotation, AnnotationAction, AnnotationId, AnnotationStatus, RoundId,
};
use crate::domain::schema_version::CURRENT_SCHEMA_VERSION;
use crate::domain::store::AnnotationFile;
use crate::markdown::{resolve_anchor, ResolvedAnchor};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
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
    // Shared by every store made with `for_scope`, so the app has one lock whichever folder is written.
    lock: Arc<Mutex<()>>,
}

fn invalid(msg: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::Invalid, msg)
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// The store that holds comments for a document in `scope`: this one for Quick Open, the project's own
    /// `.review-workspace/annotations/` for a project document (F3 spec D6). It shares this store's write lock.
    pub fn for_scope(&self, scope: &Scope) -> Store {
        let dir = match scope {
            Scope::QuickOpen => self.dir.clone(),
            Scope::Project { root, .. } => root.join(".review-workspace").join("annotations"),
        };
        Store {
            dir,
            lock: self.lock.clone(),
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
        let Some(file) = read_versioned_json::<AnnotationFile>(&path, "comments file")? else {
            return Ok(AnnotationFile {
                schema_version: CURRENT_SCHEMA_VERSION.to_string(),
                document_id: doc.document_id.clone(),
                path: doc.path.clone(),
                next_sequence: 1,
                annotations: vec![],
            });
        };
        if file.document_id != doc.document_id {
            return Err(CommandError::io(format!(
                "the comments file {} is unusable: it belongs to a different document",
                path.display()
            )));
        }
        Ok(file)
    }

    fn save(&self, doc: &OpenedDocument, mut file: AnnotationFile) -> Result<(), CommandError> {
        file.path = doc.path.clone();
        let mut json = serde_json::to_string_pretty(&file).map_err(CommandError::io)?;
        json.push('\n');
        fs::create_dir_all(&self.dir).map_err(CommandError::io)?;
        write_atomic(&self.file_path(doc), json.as_bytes())
            .map_err(|e| CommandError::io(format!("could not save comments: {e}")))
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, ()>, CommandError> {
        self.lock
            .lock()
            .map_err(|_| CommandError::io("comment store is unavailable"))
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
