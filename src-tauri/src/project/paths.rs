use crate::document::{CommandError, ErrorKind};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn invalid(msg: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::Invalid, msg)
}

/// A document is a single `.md` file name in the project root: no separator, no `..`, no leading dot (F3 spec D9).
pub fn validate_relative(name: &str) -> Result<(), CommandError> {
    let bad_char = |c: char| c == '/' || c == '\\' || c.is_control();
    if name.is_empty() || name.chars().any(bad_char) || name.starts_with('.') {
        return Err(invalid(format!("\"{name}\" is not a valid document name")));
    }
    if !name.to_ascii_lowercase().ends_with(".md") {
        return Err(invalid("only .md files can be added"));
    }
    Ok(())
}

fn io_err(e: io::Error) -> CommandError {
    let kind = if e.kind() == io::ErrorKind::NotFound {
        ErrorKind::Missing
    } else {
        ErrorKind::Io
    };
    CommandError::new(kind, e.to_string())
}

/// The canonical path of a project document. A symlink that leads outside the project is refused, so a document
/// can never be read or written through the project folder to somewhere else.
pub fn resolve_in_root(root: &Path, relative_path: &str) -> Result<PathBuf, CommandError> {
    validate_relative(relative_path)?;
    let root = fs::canonicalize(root).map_err(io_err)?;
    let file = fs::canonicalize(root.join(relative_path)).map_err(io_err)?;
    if file.parent() != Some(root.as_path()) {
        return Err(invalid(format!(
            "\"{relative_path}\" is not inside the project folder"
        )));
    }
    Ok(file)
}
