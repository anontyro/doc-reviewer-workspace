use super::render::options;
use crate::domain::anchor::{AnchorConfidence, SourceRange};
use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena};
use serde::Serialize;

/// Result of mapping a rendered-text selection back to the source. Ranges are UTF-8 byte offsets, half-open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ResolvedAnchor {
    pub confidence: AnchorConfidence,
    /// `None` when the matches sit under different headings or nothing matched.
    pub heading_path: Option<Vec<String>>,
    /// Only for `resolved`. Never a guessed pick among several matches.
    pub source_range: Option<SourceRange>,
    pub candidates: usize,
}

/// One rendered block (paragraph, heading, table cell or code block) with a source span per rendered char.
struct Block {
    chars: Vec<char>,
    spans: Vec<(usize, usize)>,
    heading_path: Vec<String>,
}

impl Block {
    fn push_mapped(&mut self, text: &str, start: usize) {
        for (i, c) in text.char_indices() {
            self.chars.push(c);
            self.spans.push((start + i, start + i + c.len_utf8()));
        }
    }

    /// shortcut: when the rendered text differs from the source (entities, escapes), every char maps to the whole
    /// node, so a selection there resolves to the node's span, not the exact characters. Refine if the spike needs it.
    fn push_coarse(&mut self, text: &str, span: (usize, usize)) {
        for c in text.chars() {
            self.chars.push(c);
            self.spans.push(span);
        }
    }
}

struct Source<'a> {
    text: &'a str,
    line_starts: Vec<usize>,
}

impl<'a> Source<'a> {
    fn new(text: &'a str) -> Self {
        let mut line_starts = vec![0];
        line_starts.extend(text.match_indices('\n').map(|(i, _)| i + 1));
        Self { text, line_starts }
    }

    /// comrak source positions are 1-based line and byte column, with an inclusive end column.
    fn span(&self, sp: comrak::nodes::Sourcepos) -> Option<(usize, usize)> {
        let start = self.line_starts.get(sp.start.line.checked_sub(1)?)?
            + sp.start.column.checked_sub(1)?;
        let end = self.line_starts.get(sp.end.line.checked_sub(1)?)? + sp.end.column;
        (start <= end && end <= self.text.len()).then_some((start, end))
    }
}

fn collect_inline<'a>(node: &'a AstNode<'a>, src: &Source, block: &mut Block) {
    for child in node.children() {
        let data = child.data.borrow();
        let span = src.span(data.sourcepos);
        match (&data.value, span) {
            (NodeValue::Text(t), Some(span)) => {
                let text: &str = t;
                if src.text.get(span.0..span.1) == Some(text) {
                    block.push_mapped(text, span.0);
                } else {
                    block.push_coarse(text, span);
                }
            }
            (NodeValue::Code(c), Some(span)) => {
                let raw = src.text.get(span.0..span.1).unwrap_or("");
                let inner = raw.trim_matches('`');
                if inner == c.literal {
                    block.push_mapped(
                        &c.literal,
                        span.0 + (raw.len() - raw.trim_start_matches('`').len()),
                    );
                } else {
                    block.push_coarse(&c.literal, span);
                }
            }
            (NodeValue::SoftBreak, Some(span)) => block.push_coarse(" ", span),
            (NodeValue::LineBreak, Some(span)) => block.push_coarse("\n", span),
            (NodeValue::HtmlInline(_), _) => {}
            _ => {
                drop(data);
                collect_inline(child, src, block);
            }
        }
    }
}

fn code_block(literal: &str, sp: comrak::nodes::Sourcepos, src: &Source, block: &mut Block) {
    // Fenced content starts on the line after the opening fence.
    let content_start = src.line_starts.get(sp.start.line).copied();
    match content_start {
        Some(start) if src.text.get(start..start + literal.len()) == Some(literal) => {
            block.push_mapped(literal, start)
        }
        _ => {
            if let Some(span) = src.span(sp) {
                block.push_coarse(literal, span)
            }
        }
    }
}

fn blocks(source: &str) -> Vec<Block> {
    let arena = Arena::new();
    let root = parse_document(&arena, source, &options());
    let src = Source::new(source);
    let mut path: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for node in root.descendants() {
        let data = node.data.borrow();
        let mut block = Block {
            chars: vec![],
            spans: vec![],
            heading_path: vec![],
        };
        match &data.value {
            NodeValue::Heading(h) => {
                collect_inline(node, &src, &mut block);
                path.truncate(usize::from(h.level).saturating_sub(1));
                path.push(block.chars.iter().collect());
            }
            NodeValue::Paragraph | NodeValue::TableCell => collect_inline(node, &src, &mut block),
            NodeValue::CodeBlock(c) => code_block(&c.literal, data.sourcepos, &src, &mut block),
            _ => continue,
        }
        block.heading_path = path.clone();
        out.push(block);
    }
    out
}

/// Finds where the user's rendered-text selection lives in the source. `prefix` and `suffix` are the rendered text
/// just before and after it in the same block, and an empty one means "no constraint".
/// One match resolves. Several are `ambiguous` and no range is guessed (PRD §6.3, AT-07). None is `orphaned`.
pub fn resolve_anchor(source: &str, selected: &str, prefix: &str, suffix: &str) -> ResolvedAnchor {
    let sel: Vec<char> = selected.chars().collect();
    let (pre, suf): (Vec<char>, Vec<char>) = (prefix.chars().collect(), suffix.chars().collect());
    let mut hits: Vec<(SourceRange, &[String])> = Vec::new();
    let all = blocks(source);
    if !sel.is_empty() {
        for b in &all {
            for i in 0..=b.chars.len().saturating_sub(sel.len()) {
                let end = i + sel.len();
                if end <= b.chars.len()
                    && b.chars[i..end] == sel[..]
                    && b.chars[..i].ends_with(&pre)
                    && b.chars[end..].starts_with(&suf)
                {
                    let range = SourceRange {
                        start: b.spans[i].0 as u64,
                        end: b.spans[end - 1].1 as u64,
                    };
                    hits.push((range, &b.heading_path));
                }
            }
        }
    }
    let heading_path = hits
        .first()
        .filter(|(_, p)| hits.iter().all(|(_, q)| q == p))
        .map(|(_, p)| p.to_vec());
    match hits.len() {
        0 => ResolvedAnchor {
            confidence: AnchorConfidence::Orphaned,
            heading_path: None,
            source_range: None,
            candidates: 0,
        },
        1 => ResolvedAnchor {
            confidence: AnchorConfidence::Resolved,
            heading_path,
            source_range: Some(hits[0].0),
            candidates: 1,
        },
        n => ResolvedAnchor {
            confidence: AnchorConfidence::Ambiguous,
            heading_path,
            source_range: None,
            candidates: n,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_missing_selection_is_orphaned_not_everywhere() {
        let src = "# T\n\nhello world\n";
        for sel in ["", "nowhere"] {
            let r = resolve_anchor(src, sel, "", "");
            assert_eq!(r.confidence, AnchorConfidence::Orphaned, "{sel:?}");
            assert_eq!(r.source_range, None);
        }
    }

    #[test]
    fn markup_at_the_edges_is_excluded_and_inside_is_included() {
        let src = "# T\n\nan **in** bold\n";
        let at = |sel| {
            resolve_anchor(src, sel, "", "")
                .source_range
                .map(|r| &src[r.start as usize..r.end as usize])
        };
        assert_eq!(at("in"), Some("in"));
        assert_eq!(at("an in"), Some("an **in"));
    }

    #[test]
    fn same_text_with_different_context_is_told_apart() {
        let src = "# T\n\nfoo bar. foo baz.\n";
        assert_eq!(
            resolve_anchor(src, "foo", "", "").confidence,
            AnchorConfidence::Ambiguous
        );
        let second = resolve_anchor(src, "foo", "bar. ", " baz.");
        assert_eq!(second.confidence, AnchorConfidence::Resolved);
        assert_eq!(
            second.source_range,
            Some(SourceRange { start: 14, end: 17 })
        );
    }
}
