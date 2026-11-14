use comrak::{markdown_to_html, Options};

/// Options shared by rendering and resolving so both see the same document structure.
pub(super) fn options() -> Options<'static> {
    let mut o = Options::default();
    o.extension.table = true;
    o.extension.strikethrough = true;
    o.render.sourcepos = true; // `data-sourcepos="l1:c1-l2:c2"` on block elements (spec D13)
                               // `render.unsafe_` stays false: raw HTML is omitted and `javascript:` links are dropped (spec D15).
    o
}

pub fn render_markdown(source: &str) -> String {
    markdown_to_html(source, &options())
}
