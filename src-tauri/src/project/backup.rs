//! Backups of the old bytes of a file, taken before every overwrite (F3 spec D26).
use super::work_dir;
use crate::document::sha256_hex;
use crate::document::{CommandError, Scope};
use crate::domain::entities::DocumentId;
use crate::store::atomic::write_atomic;
use std::{
    fs,
    path::{Path, PathBuf},
};

/// How many backups of one document are kept.
pub const KEEP: usize = 20;

/// Where backups live: inside the project for a project document, in app data for a Quick Open file.
pub struct Backups {
    quick: PathBuf,
}

impl Backups {
    pub fn new(quick: PathBuf) -> Self {
        Self { quick }
    }

    pub fn dir(&self, scope: &Scope, document: &DocumentId) -> PathBuf {
        work_dir(&self.quick, scope, "backups").join(String::from(document.clone()))
    }
}

/// Backup file names, oldest first. The time prefix sorts as text.
// shortcut: two different backups made in the same second sort by hash, so "newest" is arbitrary between them.
// That only affects skipping duplicates and which one is pruned first.
fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".md") && n.contains("Z-") && !n.starts_with('.'))
        .collect();
    names.sort();
    names
}

/// `20261120T100000Z` from an RFC 3339 time.
fn stamp(now: &str) -> Result<String, CommandError> {
    let head = now
        .get(..19)
        .ok_or_else(|| CommandError::io(format!("bad time for a backup name: {now}")))?;
    Ok(format!("{}Z", head.replace(['-', ':'], "")))
}

/// Copies `old` into `dir` as `<time>-<hash8>.md`, unless the newest backup already holds these bytes.
/// If it cannot be written the error stops the save that asked for it.
pub fn write_backup(dir: &Path, old: &[u8], now: &str) -> Result<(), CommandError> {
    let hash8 = sha256_hex(old)[..8].to_string();
    fs::create_dir_all(dir)
        .map_err(|e| CommandError::io(format!("could not make the backup folder: {e}")))?;
    if names(dir)
        .last()
        .is_some_and(|n| n.ends_with(&format!("-{hash8}.md")))
    {
        return Ok(());
    }
    let path = dir.join(format!("{}-{hash8}.md", stamp(now)?));
    write_atomic(&path, old).map_err(|e| CommandError::io(format!("could not write a backup: {e}")))
}

/// Deletes all but the newest `keep` backups. Failures are ignored: a leftover old backup is harmless.
pub fn prune(dir: &Path, keep: usize) {
    let all = names(dir);
    for old in all.iter().take(all.len().saturating_sub(keep)) {
        let _ = fs::remove_file(dir.join(old));
    }
}
