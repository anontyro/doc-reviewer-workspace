//! Projects: folders with a portable `.review-workspace/project.json`, and the library of recent ones (F3 spec D1 to D9).

pub mod backup;
pub mod drafts;
pub mod library;
pub mod paths;
pub mod service;

pub use service::{DocumentEntry, LibraryItem, ProjectView, Projects};

use crate::document::Scope;
use std::path::{Path, PathBuf};

/// The folder that holds `kind` files ("backups" or "drafts"): inside the project for a project document, in app data
/// (`quick`) for a Quick Open file (F3 spec D26, D27).
pub(crate) fn work_dir(quick: &Path, scope: &Scope, kind: &str) -> PathBuf {
    match scope {
        Scope::QuickOpen => quick.to_path_buf(),
        Scope::Project { root, .. } => root.join(".review-workspace").join(kind),
    }
}
