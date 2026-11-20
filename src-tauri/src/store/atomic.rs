use crate::document::{CommandError, ErrorKind};
use crate::domain::schema_version::check_schema_version;
use serde::de::DeserializeOwned;
use std::{
    fs::{self, File},
    io::{self, Write},
    path::Path,
    sync::atomic::{AtomicU32, Ordering},
};

/// Replaces `path` with `bytes` so a crash or error leaves either the old file or the new one, never half of one.
/// Writes a temp file in the same folder, syncs it, then renames it over the target (F2 spec D16).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent folder"))?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    let written = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
        return written;
    }
    // Best effort: make the rename itself durable.
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

static NEW_FILES: AtomicU32 = AtomicU32::new(0);

/// Creates `path` with `bytes` only if nothing is there, even when another process races for the name (F3 spec D7).
/// The bytes go to a temp file first and are then hard-linked into place, which fails if the name exists, so an
/// existing file is never replaced and a half-written one never appears under the final name.
pub fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent folder"))?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let n = NEW_FILES.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.new-{}-{n}", std::process::id()));
    let made = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::hard_link(&tmp, path)
    })();
    let _ = fs::remove_file(&tmp);
    made
}

/// Reads a JSON file this app wrote. A missing file is `None`. An unreadable file, one with no or a refused
/// `schema_version`, or one of the wrong shape is an error, and callers must never overwrite it (F2 spec D16).
/// The version is checked before the shape, so a newer file is refused even if its fields have changed.
pub fn read_versioned_json<T: DeserializeOwned>(
    path: &Path,
    what: &str,
) -> Result<Option<T>, CommandError> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(CommandError::new(
                ErrorKind::Io,
                format!("cannot read the {what}: {e}"),
            ))
        }
    };
    let unusable = |why: String| {
        CommandError::new(
            ErrorKind::Io,
            format!("the {what} {} is unusable: {why}", path.display()),
        )
    };
    let raw: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| unusable(e.to_string()))?;
    let version = raw
        .get("schema_version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| unusable("no schema_version".into()))?;
    check_schema_version(version).map_err(|e| unusable(format!("{e:?}")))?;
    serde_json::from_value(raw)
        .map(Some)
        .map_err(|e| unusable(e.to_string()))
}
