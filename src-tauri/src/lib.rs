pub mod domain;
pub mod spike;

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        spike::spike_render_markdown,
        spike::spike_resolve_anchor
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
