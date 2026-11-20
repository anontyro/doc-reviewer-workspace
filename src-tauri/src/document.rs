use crate::domain::entities::{DocumentId, ProjectId, VersionId};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

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
    /// A name is already taken, so nothing was written (F3 spec D7, D10).
    Exists,
    /// The chosen folder holds no project.
    NotProject,
    /// A project folder or document file is no longer where it was.
    Missing,
    /// The file on disk changed since it was read (used by save, F3 spec D21).
    Conflict,
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

/// Where the active document's comments live (F3 spec D6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    QuickOpen,
    Project {
        id: ProjectId,
        root: PathBuf,
        relative_path: String,
    },
}

/// The project the user is working in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectContext {
    pub id: ProjectId,
    pub root: PathBuf,
}

struct Active {
    doc: OpenedDocument,
    scope: Scope,
}

/// The single active document and the current project (F2 spec D2, F3 spec D6).
#[derive(Default)]
pub struct AppState {
    open: Mutex<Option<Active>>,
    project: Mutex<Option<ProjectContext>>,
}

fn unavailable() -> CommandError {
    CommandError::new(ErrorKind::Io, "document state is unavailable")
}

impl AppState {
    /// Makes `doc` the active document as a Quick Open file.
    pub fn set(&self, doc: OpenedDocument) -> Result<(), CommandError> {
        self.set_in(doc, Scope::QuickOpen)
    }

    pub fn set_in(&self, doc: OpenedDocument, scope: Scope) -> Result<(), CommandError> {
        *self.open.lock().map_err(|_| unavailable())? = Some(Active { doc, scope });
        Ok(())
    }

    /// Runs `f` on the open document, or fails with `no_document`.
    pub fn with_open<T>(&self, f: impl FnOnce(&OpenedDocument) -> T) -> Result<T, CommandError> {
        self.with_active(|doc, _| f(doc))
    }

    /// Runs `f` on the open document and its scope, or fails with `no_document`.
    pub fn with_active<T>(
        &self,
        f: impl FnOnce(&OpenedDocument, &Scope) -> T,
    ) -> Result<T, CommandError> {
        match self.open.lock().map_err(|_| unavailable())?.as_ref() {
            Some(a) => Ok(f(&a.doc, &a.scope)),
            None => Err(CommandError::new(
                ErrorKind::NoDocument,
                "no document is open",
            )),
        }
    }

    /// Saves `text` over the active document's file if the file still has `expected_hash`, then makes the saved
    /// file the active document (F3 spec D21). The state stays locked throughout, so two saves cannot interleave.
    pub fn save(&self, text: &str, expected_hash: &str) -> Result<OpenedDocument, CommandError> {
        let mut guard = self.open.lock().map_err(|_| unavailable())?;
        let active = guard
            .as_mut()
            .ok_or_else(|| CommandError::new(ErrorKind::NoDocument, "no document is open"))?;
        let saved = save_text(&active.doc, text, expected_hash)?;
        active.doc = saved.clone();
        Ok(saved)
    }

    /// Switches project and closes the active document, so a document of one project is never shown in another.
    pub fn set_project(&self, project: Option<ProjectContext>) -> Result<(), CommandError> {
        *self.open.lock().map_err(|_| unavailable())? = None;
        *self.project_guard()? = project;
        Ok(())
    }

    /// The current project, or `not_project`.
    pub fn project(&self) -> Result<ProjectContext, CommandError> {
        self.project_guard()?
            .clone()
            .ok_or_else(|| CommandError::new(ErrorKind::NotProject, "no project is open"))
    }

    /// Forgets the current project if it is `id`.
    pub fn leave_project(&self, id: &ProjectId) -> Result<(), CommandError> {
        let is_current = self.project_guard()?.as_ref().is_some_and(|p| &p.id == id);
        if is_current {
            self.set_project(None)?;
        }
        Ok(())
    }

    fn project_guard(&self) -> Result<MutexGuard<'_, Option<ProjectContext>>, CommandError> {
        self.project.lock().map_err(|_| unavailable())
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn io(e: std::io::Error) -> CommandError {
    CommandError::new(ErrorKind::Io, e.to_string())
}

/// Reads and renders a file. Never writes to it (AT-02).
pub fn open_path(path: &Path) -> Result<OpenedDocument, CommandError> {
    open_with(path, |canonical| sha256_hex(canonical.as_bytes()))
}

/// Opens a document of a project. Its id comes from the project id and file name, so it survives moving the
/// project folder (F3 spec D9). `relative_path` must already be validated by `project::paths`.
pub fn open_in_project(
    root: &Path,
    project: &ProjectId,
    relative_path: &str,
) -> Result<OpenedDocument, CommandError> {
    let path = crate::project::paths::resolve_in_root(root, relative_path)?;
    let project = String::from(project.clone());
    open_with(&path, |_| {
        sha256_hex(format!("{project}/{relative_path}").as_bytes())
    })
}

fn open_with(
    path: &Path,
    id_source_hash: impl FnOnce(&str) -> String,
) -> Result<OpenedDocument, CommandError> {
    let path = fs::canonicalize(path).map_err(io)?;
    let path_str = path.to_string_lossy().into_owned();
    let document_id = DocumentId::try_from(format!("doc_{}", &id_source_hash(&path_str)[..16]))
        .map_err(|e| CommandError::new(ErrorKind::Invalid, e))?;
    read_document(path, document_id)
}

/// Reads, checks and renders the file at `path` (already canonical) as the document `document_id`.
fn read_document(path: PathBuf, document_id: DocumentId) -> Result<OpenedDocument, CommandError> {
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
    Ok(OpenedDocument {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        document_id,
        version_id: VersionId::try_from(format!("ver_{}", &source_hash[..16]))
            .map_err(|e| CommandError::new(ErrorKind::Invalid, e))?,
        html: crate::markdown::render_markdown(&source),
        path: path.to_string_lossy().into_owned(),
        source_hash,
        source,
    })
}

/// Writes `text` over the file of `doc`, but only if the file on disk still has the bytes `expected_hash` names
/// (F3 spec D21). The write is atomic and keeps the file's permissions. Returns the document as it now is on disk,
/// with the same id. Nothing is written on any error.
fn save_text(
    doc: &OpenedDocument,
    text: &str,
    expected_hash: &str,
) -> Result<OpenedDocument, CommandError> {
    if text.len() as u64 > MAX_BYTES {
        return Err(CommandError::new(
            ErrorKind::TooLarge,
            "text is larger than 10 MiB",
        ));
    }
    let path = Path::new(&doc.path);
    let on_disk = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(CommandError::new(
                ErrorKind::Missing,
                format!("{} is no longer where it was", doc.path),
            ))
        }
        Err(e) => return Err(io(e)),
    };
    if sha256_hex(&on_disk) != expected_hash {
        return Err(CommandError::new(
            ErrorKind::Conflict,
            "the file changed on disk since it was opened",
        ));
    }
    let permissions = fs::metadata(path).map_err(io)?.permissions();
    crate::store::atomic::write_atomic(path, text.as_bytes())
        .map_err(|e| CommandError::new(ErrorKind::Io, format!("could not save: {e}")))?;
    // shortcut: permissions are restored after the rename, so a failure here leaves the new text with default
    // permissions. Upgrade when F4 versions need exact modes.
    let _ = fs::set_permissions(path, permissions);
    read_document(path.to_path_buf(), doc.document_id.clone())
}
