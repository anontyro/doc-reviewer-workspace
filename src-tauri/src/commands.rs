use crate::document::{open_path, AppState, CommandError, ErrorKind, OpenedDocument};
use crate::domain::entities::Annotation;
use crate::markdown::{resolve_anchor, ResolvedAnchor};
use crate::store::annotations::now_rfc3339;
use crate::store::{AnnotationView, Store};
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

/// Saves a comment on a selection of the open document. Rust resolves the selection itself and refuses anything but
/// one exact match (F2 spec D19).
#[tauri::command]
pub fn create_annotation(
    state: State<'_, AppState>,
    store: State<'_, Store>,
    selected: String,
    prefix: String,
    suffix: String,
    text: String,
) -> Result<Annotation, CommandError> {
    state.with_open(|doc| store.create(doc, &selected, &prefix, &suffix, &text, &now_rfc3339()))?
}

#[tauri::command]
pub fn list_annotations(
    state: State<'_, AppState>,
    store: State<'_, Store>,
) -> Result<Vec<AnnotationView>, CommandError> {
    state.with_open(|doc| store.list(doc))?
}

#[tauri::command]
pub fn update_annotation(
    state: State<'_, AppState>,
    store: State<'_, Store>,
    id: String,
    text: String,
) -> Result<Annotation, CommandError> {
    state.with_open(|doc| store.update(doc, &id, &text, &now_rfc3339()))?
}

#[tauri::command]
pub fn delete_annotation(
    state: State<'_, AppState>,
    store: State<'_, Store>,
    id: String,
) -> Result<(), CommandError> {
    state.with_open(|doc| store.delete(doc, &id))?
}
