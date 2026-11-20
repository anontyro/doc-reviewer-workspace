//! Markdown rendering and anchor resolution with comrak (FoundationSpike decisions 0004 and 0005).

mod render;
mod resolve;

pub use render::render_markdown;
pub use resolve::{resolve_anchor, ResolvedAnchor};
