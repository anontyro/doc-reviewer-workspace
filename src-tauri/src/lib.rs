pub mod commands;
pub mod document;
pub mod domain;
pub mod feedback;
pub mod markdown;
pub mod project;
pub mod store;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(document::AppState::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?.join("annotations");
            app.manage(store::Store::new(dir));
            app.manage(project::Projects::new(
                app.path().app_data_dir()?.join("library.json"),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_markdown,
            commands::create_project,
            commands::open_project,
            commands::open_project_at,
            commands::list_library,
            commands::rename_project,
            commands::remove_from_library,
            commands::add_document,
            commands::open_project_document,
            commands::resolve_selection,
            commands::create_annotation,
            commands::list_annotations,
            commands::update_annotation,
            commands::delete_annotation,
            commands::generate_feedback
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
