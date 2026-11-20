use super::{library, paths};
use crate::document::{sha256_hex, CommandError, ErrorKind, MAX_BYTES};
use crate::domain::entities::{DocumentFormat, ProjectId};
use crate::domain::project::{LibraryRecord, ProjectDocument, ProjectFile};
use crate::domain::schema_version::CURRENT_SCHEMA_VERSION;
use crate::store::atomic::{read_versioned_json, write_atomic, write_new};
use serde::Serialize;
use std::{
    fs,
    io::ErrorKind as IoKind,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

const DIR: &str = ".review-workspace";
const FILE: &str = "project.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocumentEntry {
    pub relative_path: String,
    pub name: String,
}

/// What the UI is told about an open project (F3 spec D5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectView {
    pub id: ProjectId,
    pub name: String,
    pub root_path: String,
    pub documents: Vec<DocumentEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LibraryItem {
    pub project_id: ProjectId,
    pub name: String,
    pub root_path: String,
    pub last_opened_at: String,
    /// The folder or its `project.json` is gone. The entry is kept (F3 spec D4).
    pub missing: bool,
}

fn io(msg: impl std::fmt::Display) -> CommandError {
    CommandError::new(ErrorKind::Io, msg.to_string())
}

/// A project name is 1 to 100 characters after trimming, with no control characters (F3 spec D5).
pub fn clean_name(name: &str) -> Result<String, CommandError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err(CommandError::new(
            ErrorKind::Invalid,
            "a project name is 1 to 100 characters with no control characters",
        ));
    }
    Ok(name.to_string())
}

fn project_path(root: &Path) -> PathBuf {
    root.join(DIR).join(FILE)
}

fn read_project(root: &Path) -> Result<ProjectFile, CommandError> {
    read_versioned_json::<ProjectFile>(&project_path(root), "project file")?.ok_or_else(|| {
        CommandError::new(
            ErrorKind::NotProject,
            "that folder is not a project (it has no .review-workspace/project.json)",
        )
    })
}

fn view(root: &Path, p: &ProjectFile) -> ProjectView {
    ProjectView {
        id: p.id.clone(),
        name: p.name.clone(),
        root_path: root.to_string_lossy().into_owned(),
        documents: p
            .documents
            .iter()
            .map(|d| DocumentEntry {
                relative_path: d.relative_path.clone(),
                name: d.relative_path.clone(),
            })
            .collect(),
    }
}

fn canonical(path: &Path) -> Result<PathBuf, CommandError> {
    fs::canonicalize(path).map_err(|e| {
        let kind = if e.kind() == IoKind::NotFound {
            ErrorKind::Missing
        } else {
            ErrorKind::Io
        };
        CommandError::new(kind, format!("{}: {e}", path.display()))
    })
}

/// Creates, opens, renames and adds to projects, and keeps the library. One lock covers every read-modify-write.
pub struct Projects {
    library: PathBuf,
    lock: Mutex<()>,
}

impl Projects {
    pub fn new(library: PathBuf) -> Self {
        Self {
            library,
            lock: Mutex::new(()),
        }
    }

    fn locked(&self) -> Result<MutexGuard<'_, ()>, CommandError> {
        self.lock
            .lock()
            .map_err(|_| io("project state is unavailable"))
    }

    fn write_project(&self, root: &Path, p: &ProjectFile) -> Result<(), CommandError> {
        let mut json = serde_json::to_string_pretty(p).map_err(io)?;
        json.push('\n');
        write_atomic(&project_path(root), json.as_bytes())
            .map_err(|e| io(format!("could not save the project: {e}")))
    }

    fn remember(&self, root: &Path, p: &ProjectFile, now: &str) -> Result<(), CommandError> {
        let mut lib = library::read(&self.library)?;
        library::upsert(
            &mut lib,
            LibraryRecord {
                project_id: p.id.clone(),
                name: p.name.clone(),
                root_path: root.to_string_lossy().into_owned(),
                last_opened_at: now.to_string(),
            },
        );
        library::write(&self.library, &mut lib)
    }

    /// Makes a project in `folder`. Files already there are left alone and not tracked. A folder that already
    /// holds a project is refused.
    pub fn create(
        &self,
        folder: &Path,
        name: &str,
        now: &str,
    ) -> Result<ProjectView, CommandError> {
        let name = clean_name(name)?;
        let _g = self.locked()?;
        let root = canonical(folder)?;
        if project_path(&root).exists() {
            return Err(CommandError::new(
                ErrorKind::Exists,
                "that folder is already a project",
            ));
        }
        let root_str = root.to_string_lossy();
        let id = ProjectId::try_from(format!(
            "proj_{}",
            &sha256_hex(format!("{root_str}{now}").as_bytes())[..16]
        ))
        .map_err(|e| CommandError::new(ErrorKind::Invalid, e))?;
        let project = ProjectFile {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            id,
            name,
            created_at: now.to_string(),
            updated_at: now.to_string(),
            documents: vec![],
        };
        fs::create_dir_all(root.join(DIR)).map_err(io)?;
        let mut json = serde_json::to_string_pretty(&project).map_err(io)?;
        json.push('\n');
        write_new(&project_path(&root), json.as_bytes()).map_err(|e| {
            if e.kind() == IoKind::AlreadyExists {
                CommandError::new(ErrorKind::Exists, "that folder is already a project")
            } else {
                io(format!("could not create the project: {e}"))
            }
        })?;
        self.remember(&root, &project, now)?;
        Ok(view(&root, &project))
    }

    /// Opens the project in `folder`. If its id is already in the library the entry follows the folder.
    pub fn open(&self, folder: &Path, now: &str) -> Result<ProjectView, CommandError> {
        let _g = self.locked()?;
        let root = canonical(folder)?;
        let project = read_project(&root)?;
        self.remember(&root, &project, now)?;
        Ok(view(&root, &project))
    }

    pub fn open_at(&self, id: &ProjectId, now: &str) -> Result<ProjectView, CommandError> {
        let _g = self.locked()?;
        let lib = library::read(&self.library)?;
        let root = self.root_of(&lib, id)?;
        let project = read_project(&root)?;
        if &project.id != id {
            return Err(CommandError::new(
                ErrorKind::NotProject,
                "the folder now holds a different project",
            ));
        }
        self.remember(&root, &project, now)?;
        Ok(view(&root, &project))
    }

    fn root_of(
        &self,
        lib: &crate::domain::project::LibraryFile,
        id: &ProjectId,
    ) -> Result<PathBuf, CommandError> {
        let record = library::find(lib, id)?;
        let root = PathBuf::from(&record.root_path);
        if !project_path(&root).is_file() {
            return Err(CommandError::new(
                ErrorKind::Missing,
                format!("the folder {} is missing", root.display()),
            ));
        }
        Ok(root)
    }

    pub fn list(&self) -> Result<Vec<LibraryItem>, CommandError> {
        let _g = self.locked()?;
        Ok(library::read(&self.library)?
            .entries
            .into_iter()
            .map(|e| LibraryItem {
                missing: !project_path(Path::new(&e.root_path)).is_file(),
                project_id: e.project_id,
                name: e.name,
                root_path: e.root_path,
                last_opened_at: e.last_opened_at,
            })
            .collect())
    }

    /// Changes the name in `project.json` and the library. The folder name is not touched (F3 spec D8).
    pub fn rename(
        &self,
        id: &ProjectId,
        name: &str,
        now: &str,
    ) -> Result<ProjectView, CommandError> {
        let name = clean_name(name)?;
        let _g = self.locked()?;
        let mut lib = library::read(&self.library)?;
        let root = self.root_of(&lib, id)?;
        let mut project = read_project(&root)?;
        project.name = name.clone();
        project.updated_at = now.to_string();
        self.write_project(&root, &project)?;
        if let Some(e) = lib.entries.iter_mut().find(|e| &e.project_id == id) {
            e.name = name;
        }
        library::write(&self.library, &mut lib)?;
        Ok(view(&root, &project))
    }

    /// Forgets the library entry only. No file or folder is touched (F3 spec D8).
    pub fn remove(&self, id: &ProjectId) -> Result<(), CommandError> {
        let _g = self.locked()?;
        let mut lib = library::read(&self.library)?;
        lib.entries.retain(|e| &e.project_id != id);
        library::write(&self.library, &mut lib)
    }

    /// Is `relative_path` one of the project's added documents?
    pub fn has_document(&self, root: &Path, relative_path: &str) -> Result<bool, CommandError> {
        let _g = self.locked()?;
        Ok(read_project(root)?
            .documents
            .iter()
            .any(|d| d.relative_path == relative_path))
    }

    /// Copies `source` into the project root and tracks it. Never overwrites a file (F3 spec D7).
    pub fn add_document(
        &self,
        root: &Path,
        source: &Path,
        now: &str,
    ) -> Result<ProjectView, CommandError> {
        let _g = self.locked()?;
        let root = canonical(root)?;
        let mut project = read_project(&root)?;
        let source = canonical(source)?;
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        paths::validate_relative(&name)?;
        if fs::metadata(&source).map_err(io)?.len() > MAX_BYTES {
            return Err(CommandError::new(
                ErrorKind::TooLarge,
                "file is larger than 10 MiB",
            ));
        }
        let bytes = fs::read(&source).map_err(io)?;
        if std::str::from_utf8(&bytes).is_err() {
            return Err(CommandError::new(
                ErrorKind::NotUtf8,
                "file is not UTF-8 text",
            ));
        }
        let taken = || {
            CommandError::new(
                ErrorKind::Exists,
                format!("\"{name}\" is already in this project. Rename the source file and add it again."),
            )
        };
        if project.documents.iter().any(|d| d.relative_path == name) {
            return Err(taken());
        }
        let dest = root.join(&name);
        let copied = source.parent() != Some(root.as_path());
        if copied {
            write_new(&dest, &bytes).map_err(|e| {
                if e.kind() == IoKind::AlreadyExists {
                    taken()
                } else {
                    io(format!("could not copy the file: {e}"))
                }
            })?;
        }
        project.documents.push(ProjectDocument {
            relative_path: name,
            format: DocumentFormat::Markdown,
            added_at: now.to_string(),
        });
        project.updated_at = now.to_string();
        if let Err(e) = self.write_project(&root, &project) {
            if copied {
                let _ = fs::remove_file(&dest); // the copy is ours, nothing else points at it yet
            }
            return Err(e);
        }
        Ok(view(&root, &project))
    }
}
