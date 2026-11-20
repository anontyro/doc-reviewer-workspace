use std::{
    fs::{self, File},
    io::{self, Write},
    path::Path,
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
