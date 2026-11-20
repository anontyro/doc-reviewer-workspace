use crate::document::{open_path, AppState, CommandError, ErrorKind, OpenedDocument};
use crate::markdown::{resolve_anchor, ResolvedAnchor};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// Shows a native open dialog and opens the chosen file. `None` means the user cancelled (F2 spec D1).
// Async so the blocking dialog does not run on the main thread.
#[tauri::command]
pub async fn open_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OpenedDocument>, CommandError> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| CommandError::new(ErrorKind::Io, e.to_string()))?;
    let doc = open_path(&path)?;
    state.set(doc.clone())?;
    Ok(Some(doc))
}

/// Maps a rendered-text selection to the open document's source (F2 spec D5).
#[tauri::command]
pub fn resolve_selection(
    state: State<'_, AppState>,
    selected: String,
    prefix: String,
    suffix: String,
) -> Result<ResolvedAnchor, CommandError> {
    state.with_open(|doc| resolve_anchor(&doc.source, &selected, &prefix, &suffix))
}
