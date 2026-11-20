use crate::document::{
    open_in_project, open_path, AppState, CommandError, ErrorKind, OpenedDocument, ProjectContext,
    Scope,
};
use crate::domain::entities::Annotation;
use crate::domain::entities::ProjectId;
use crate::feedback::{build_feedback, FeedbackInput};
use crate::markdown::{resolve_anchor, ResolvedAnchor};
use crate::project::service::clean_name;
use crate::project::{LibraryItem, ProjectView, Projects};
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

/// Saves the editor's text over the active file unless the file changed on disk since `expected_hash` (F3 spec D21).
#[tauri::command]
pub fn save_document(
    state: State<'_, AppState>,
    text: String,
    expected_hash: String,
) -> Result<OpenedDocument, CommandError> {
    state.save(&text, &expected_hash)
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
    state.with_active(|doc, scope| {
        store
            .for_scope(scope)
            .create(doc, &selected, &prefix, &suffix, &text, &now_rfc3339())
    })?
}

#[tauri::command]
pub fn list_annotations(
    state: State<'_, AppState>,
    store: State<'_, Store>,
) -> Result<Vec<AnnotationView>, CommandError> {
    state.with_active(|doc, scope| store.for_scope(scope).list(doc))?
}

#[tauri::command]
pub fn update_annotation(
    state: State<'_, AppState>,
    store: State<'_, Store>,
    id: String,
    text: String,
) -> Result<Annotation, CommandError> {
    state.with_active(|doc, scope| {
        store
            .for_scope(scope)
            .update(doc, &id, &text, &now_rfc3339())
    })?
}

#[tauri::command]
pub fn delete_annotation(
    state: State<'_, AppState>,
    store: State<'_, Store>,
    id: String,
) -> Result<(), CommandError> {
    state.with_active(|doc, scope| store.for_scope(scope).delete(doc, &id))?
}

/// The exact prompt the export panel shows and copies (F2 spec D25).
#[tauri::command]
pub fn generate_feedback(
    state: State<'_, AppState>,
    store: State<'_, Store>,
) -> Result<String, CommandError> {
    state.with_active(|doc, scope| {
        let annotations = store.for_scope(scope).list(doc)?;
        Ok(build_feedback(&FeedbackInput {
            name: &doc.name,
            version_id: &String::from(doc.version_id.clone()),
            source_hash: &doc.source_hash,
            source: &doc.source,
            annotations: &annotations,
        }))
    })?
}

fn to_error(e: impl std::fmt::Display) -> CommandError {
    CommandError::new(ErrorKind::Io, e.to_string())
}

/// Makes the project the current one, so project documents can be opened and added.
fn enter(state: &AppState, view: &ProjectView) -> Result<(), CommandError> {
    state.set_project(Some(ProjectContext {
        id: view.id.clone(),
        root: view.root_path.clone().into(),
    }))
}

/// Shows a native folder dialog and makes a project there. `None` means the user cancelled (F3 spec D5).
#[tauri::command]
pub async fn create_project(
    app: AppHandle,
    state: State<'_, AppState>,
    projects: State<'_, Projects>,
    name: String,
) -> Result<Option<ProjectView>, CommandError> {
    clean_name(&name)?; // refuse a bad name before showing a dialog
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(to_error)?;
    let view = projects.create(&folder, &name, &now_rfc3339())?;
    enter(&state, &view)?;
    Ok(Some(view))
}

/// Shows a native folder dialog and opens the project in it. `None` means the user cancelled.
#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    state: State<'_, AppState>,
    projects: State<'_, Projects>,
) -> Result<Option<ProjectView>, CommandError> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(to_error)?;
    let view = projects.open(&folder, &now_rfc3339())?;
    enter(&state, &view)?;
    Ok(Some(view))
}

#[tauri::command]
pub fn open_project_at(
    state: State<'_, AppState>,
    projects: State<'_, Projects>,
    project_id: ProjectId,
) -> Result<ProjectView, CommandError> {
    let view = projects.open_at(&project_id, &now_rfc3339())?;
    enter(&state, &view)?;
    Ok(view)
}

#[tauri::command]
pub fn list_library(projects: State<'_, Projects>) -> Result<Vec<LibraryItem>, CommandError> {
    projects.list()
}

#[tauri::command]
pub fn rename_project(
    projects: State<'_, Projects>,
    project_id: ProjectId,
    name: String,
) -> Result<ProjectView, CommandError> {
    projects.rename(&project_id, &name, &now_rfc3339())
}

/// Forgets a project in the library. Never deletes anything on disk (F3 spec D8).
#[tauri::command]
pub fn remove_from_library(
    state: State<'_, AppState>,
    projects: State<'_, Projects>,
    project_id: ProjectId,
) -> Result<(), CommandError> {
    projects.remove(&project_id)?;
    state.leave_project(&project_id)
}

/// Shows a native file dialog and copies the chosen Markdown file into the current project. `None` means cancelled.
#[tauri::command]
pub async fn add_document(
    app: AppHandle,
    state: State<'_, AppState>,
    projects: State<'_, Projects>,
) -> Result<Option<ProjectView>, CommandError> {
    let project = state.project()?;
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let source = picked.into_path().map_err(to_error)?;
    Ok(Some(projects.add_document(
        &project.root,
        &source,
        &now_rfc3339(),
    )?))
}

/// Reads a project document fresh from disk and makes it the active one (F3 spec D14).
#[tauri::command]
pub fn open_project_document(
    state: State<'_, AppState>,
    projects: State<'_, Projects>,
    relative_path: String,
) -> Result<OpenedDocument, CommandError> {
    let project = state.project()?;
    if !projects.has_document(&project.root, &relative_path)? {
        return Err(CommandError::new(
            ErrorKind::Invalid,
            format!("\"{relative_path}\" is not a document of this project"),
        ));
    }
    let doc = open_in_project(&project.root, &project.id, &relative_path)?;
    state.set_in(
        doc.clone(),
        Scope::Project {
            id: project.id,
            root: project.root,
            relative_path,
        },
    )?;
    Ok(doc)
}
