//! Spike engine B (spec D12): Markdown render and anchor resolution in Rust with comrak.
//! Throwaway until F1's decision 0004 picks an engine. Delete this folder in F2 if engine A wins.

mod render;
mod resolve;

pub use render::render_markdown;
pub use resolve::{resolve_anchor, ResolvedAnchor};

// Dev-only commands for the spike view (spec D18). Not compiled into release builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn spike_render_markdown(source: String) -> String {
    render_markdown(&source)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn spike_resolve_anchor(
    source: String,
    selected: String,
    prefix: String,
    suffix: String,
) -> ResolvedAnchor {
    resolve_anchor(&source, &selected, &prefix, &suffix)
}
