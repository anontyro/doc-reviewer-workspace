pub mod commands;
pub mod document;
pub mod domain;
pub mod markdown;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(document::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_markdown,
            commands::resolve_selection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
