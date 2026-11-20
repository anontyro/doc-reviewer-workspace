use crate::domain::entities::{DocumentId, VersionId};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::Mutex};

/// Largest file the reader opens (F2 spec D1).
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NoDocument,
    NotUtf8,
    TooLarge,
    Io,
    Invalid,
}

/// The error every command returns (F2 spec D5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommandError {
    pub kind: ErrorKind,
    pub message: String,
}

impl CommandError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenedDocument {
    pub path: String,
    pub name: String,
    pub document_id: DocumentId,
    pub version_id: VersionId,
    /// sha256 (hex) of the file bytes.
    pub source_hash: String,
    pub source: String,
    pub html: String,
}

/// The single open document (F2 spec D2).
#[derive(Default)]
pub struct AppState {
    open: Mutex<Option<OpenedDocument>>,
}

impl AppState {
    pub fn set(&self, doc: OpenedDocument) -> Result<(), CommandError> {
        *self.guard()? = Some(doc);
        Ok(())
    }

    /// Runs `f` on the open document, or fails with `no_document`.
    pub fn with_open<T>(&self, f: impl FnOnce(&OpenedDocument) -> T) -> Result<T, CommandError> {
        match self.guard()?.as_ref() {
            Some(doc) => Ok(f(doc)),
            None => Err(CommandError::new(
                ErrorKind::NoDocument,
                "no document is open",
            )),
        }
    }

    fn guard(&self) -> Result<std::sync::MutexGuard<'_, Option<OpenedDocument>>, CommandError> {
        self.open
            .lock()
            .map_err(|_| CommandError::new(ErrorKind::Io, "document state is unavailable"))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn io(e: std::io::Error) -> CommandError {
    CommandError::new(ErrorKind::Io, e.to_string())
}

/// Reads and renders a file. Never writes to it (AT-02).
pub fn open_path(path: &Path) -> Result<OpenedDocument, CommandError> {
    let path = fs::canonicalize(path).map_err(io)?;
    if fs::metadata(&path).map_err(io)?.len() > MAX_BYTES {
        return Err(CommandError::new(
            ErrorKind::TooLarge,
            "file is larger than 10 MiB",
        ));
    }
    let bytes = fs::read(&path).map_err(io)?;
    let source_hash = sha256_hex(&bytes);
    let source = String::from_utf8(bytes)
        .map_err(|_| CommandError::new(ErrorKind::NotUtf8, "file is not UTF-8 text"))?;
    let path_str = path.to_string_lossy().into_owned();
    let invalid = |e: String| CommandError::new(ErrorKind::Invalid, e);
    Ok(OpenedDocument {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        document_id: DocumentId::try_from(format!(
            "doc_{}",
            &sha256_hex(path_str.as_bytes())[..16]
        ))
        .map_err(invalid)?,
        version_id: VersionId::try_from(format!("ver_{}", &source_hash[..16])).map_err(invalid)?,
        html: crate::markdown::render_markdown(&source),
        path: path_str,
        source_hash,
        source,
    })
}
