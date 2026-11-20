//! Unsaved editor text kept on disk so a crash loses nothing (F3 spec D27).
use super::work_dir;
use crate::document::{CommandError, ErrorKind, Scope, MAX_BYTES};
use crate::domain::entities::DocumentId;
use crate::domain::project::DraftFile;
use crate::domain::schema_version::CURRENT_SCHEMA_VERSION;
use crate::store::atomic::{read_versioned_json, write_atomic};
use std::{fs, io::ErrorKind as IoKind, path::PathBuf, sync::Mutex};

pub struct Drafts {
    quick: PathBuf,
    // One writer at a time: two saves of the same draft would share a temp file name.
    lock: Mutex<()>,
}

fn io(msg: impl std::fmt::Display) -> CommandError {
    CommandError::new(ErrorKind::Io, msg.to_string())
}

impl Drafts {
    pub fn new(quick: PathBuf) -> Self {
        Self {
            quick,
            lock: Mutex::new(()),
        }
    }

    fn path(&self, scope: &Scope, document: &DocumentId) -> PathBuf {
        work_dir(&self.quick, scope, "drafts")
            .join(format!("{}.json", String::from(document.clone())))
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, ()>, CommandError> {
        self.lock.lock().map_err(|_| io("drafts are unavailable"))
    }

    /// The saved draft, if any. An unreadable or newer file is an error and is left where it is.
    pub fn read(
        &self,
        scope: &Scope,
        document: &DocumentId,
    ) -> Result<Option<DraftFile>, CommandError> {
        let _g = self.locked()?;
        read_versioned_json(&self.path(scope, document), "draft")
    }

    /// Writes the draft atomically. An existing draft that cannot be read is never overwritten.
    pub fn save(
        &self,
        scope: &Scope,
        document: &DocumentId,
        text: &str,
        base_hash: &str,
        now: &str,
    ) -> Result<(), CommandError> {
        if text.len() as u64 > MAX_BYTES {
            return Err(CommandError::new(
                ErrorKind::TooLarge,
                "text is larger than 10 MiB",
            ));
        }
        let _g = self.locked()?;
        let path = self.path(scope, document);
        read_versioned_json::<DraftFile>(&path, "draft")?;
        let draft = DraftFile {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            document_id: document.clone(),
            base_hash: base_hash.to_string(),
            text: text.to_string(),
            saved_at: now.to_string(),
        };
        let json = serde_json::to_string_pretty(&draft).map_err(io)?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }
        write_atomic(&path, json.as_bytes())
            .map_err(|e| io(format!("could not save the draft: {e}")))
    }

    /// Removes the draft. A draft that cannot be read is left alone and reported.
    pub fn clear(&self, scope: &Scope, document: &DocumentId) -> Result<(), CommandError> {
        let _g = self.locked()?;
        let path = self.path(scope, document);
        read_versioned_json::<DraftFile>(&path, "draft")?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == IoKind::NotFound => Ok(()),
            Err(e) => Err(io(e)),
        }
    }
}
