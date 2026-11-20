//! The library file: recent projects, kept in app data (F3 spec D4). It is a cache and can be rebuilt by opening
//! the folders again.
use crate::document::{CommandError, ErrorKind};
use crate::domain::entities::ProjectId;
use crate::domain::project::{LibraryFile, LibraryRecord};
use crate::domain::schema_version::CURRENT_SCHEMA_VERSION;
use crate::store::atomic::{read_versioned_json, write_atomic};
use std::{fs, path::Path};

fn io(msg: impl std::fmt::Display) -> CommandError {
    CommandError::new(ErrorKind::Io, msg.to_string())
}

/// A missing file is an empty library. An unreadable or newer one is an error and is never overwritten.
pub fn read(path: &Path) -> Result<LibraryFile, CommandError> {
    Ok(
        read_versioned_json::<LibraryFile>(path, "library file")?.unwrap_or_else(|| LibraryFile {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            entries: vec![],
        }),
    )
}

/// Writes the library newest first, then by project id, so the file is the same whatever order things happened in.
pub fn write(path: &Path, file: &mut LibraryFile) -> Result<(), CommandError> {
    file.entries.sort_by(|a, b| {
        b.last_opened_at.cmp(&a.last_opened_at).then_with(|| {
            String::from(a.project_id.clone()).cmp(&String::from(b.project_id.clone()))
        })
    });
    let mut json = serde_json::to_string_pretty(file).map_err(io)?;
    json.push('\n');
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io)?;
    }
    write_atomic(path, json.as_bytes()).map_err(|e| io(format!("could not save the library: {e}")))
}

/// Adds the project, or updates the entry that has the same id (so a moved folder is found again).
pub fn upsert(file: &mut LibraryFile, record: LibraryRecord) {
    match file
        .entries
        .iter_mut()
        .find(|e| e.project_id == record.project_id)
    {
        Some(existing) => *existing = record,
        None => file.entries.push(record),
    }
}

pub fn find<'a>(file: &'a LibraryFile, id: &ProjectId) -> Result<&'a LibraryRecord, CommandError> {
    file.entries
        .iter()
        .find(|e| &e.project_id == id)
        .ok_or_else(|| CommandError::new(ErrorKind::Missing, "that project is not in the library"))
}
