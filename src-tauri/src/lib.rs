pub mod commands;
pub mod document;
pub mod domain;
pub mod feedback;
pub mod markdown;
pub mod store;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(document::AppState::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?.join("annotations");
            app.manage(store::Store::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_markdown,
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
