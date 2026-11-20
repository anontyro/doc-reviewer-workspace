//! The deterministic feedback prompt (F2 spec D21 to D24). A pure function: the same input gives the same bytes.
use crate::domain::anchor::AnchorConfidence;
use crate::domain::entities::AnnotationStatus;
use crate::store::AnnotationView;

pub struct FeedbackInput<'a> {
    pub name: &'a str,
    pub version_id: &'a str,
    pub source_hash: &'a str,
    pub source: &'a str,
    pub annotations: &'a [AnnotationView],
}

/// A fence one backtick longer than the longest run inside `content` (at least three), so the content is verbatim.
fn fenced(content: &str) -> String {
    let mut longest = 0;
    let mut run = 0;
    for c in content.chars() {
        run = if c == '`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    let fence = "`".repeat((longest + 1).max(3));
    format!("{fence}\n{content}\n{fence}\n")
}

/// 1-based line of a byte offset.
fn line_at(source: &str, offset: usize) -> usize {
    1 + source.as_bytes()[..offset.min(source.len())]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
}

fn source_lines(source: &str, start: u64, end: u64) -> String {
    let first = line_at(source, start as usize);
    // `end` is exclusive, so the last byte of the range is `end - 1`.
    let last = line_at(source, (end as usize).saturating_sub(1).max(start as usize));
    if first == last {
        first.to_string()
    } else {
        format!("{first}–{last}")
    }
}

pub fn build_feedback(input: &FeedbackInput) -> String {
    let mut open: Vec<&AnnotationView> = input
        .annotations
        .iter()
        .filter(|v| v.annotation.status == AnnotationStatus::Open)
        .collect();
    // By where the quote is now. Ones with no unique place go last. Then by id.
    open.sort_by_key(|v| {
        let start = v.current.source_range.map_or(u64::MAX, |r| r.start);
        (start, String::from(v.annotation.id.clone()))
    });

    let mut out = String::new();
    out.push_str("# Review Instructions\n\n");
    out.push_str(&format!("Document: {}\n", input.name));
    out.push_str(&format!(
        "Source: version {}, sha256 {}\n\n",
        input.version_id, input.source_hash
    ));
    out.push_str("## Instructions\n\n");
    out.push_str("Apply only the requested revisions to this document.\n");
    out.push_str("Preserve every section and passage that is not mentioned.\n");
    out.push_str("If a target is ambiguous or the instructions conflict, report the problem instead of guessing.\n\n");
    out.push_str("## Comments\n\n");
    if open.is_empty() {
        out.push_str("There are no comments.\n");
        return out;
    }
    for (n, v) in open.iter().enumerate() {
        if n > 0 {
            out.push('\n');
        }
        let a = &v.annotation;
        out.push_str(&format!("### {} — COMMENT\n", String::from(a.id.clone())));
        if !a.anchor.heading_path.is_empty() {
            out.push_str(&format!("Section: {}\n", a.anchor.heading_path.join(" > ")));
        }
        match (v.current.confidence, v.current.source_range) {
            (AnchorConfidence::Resolved, Some(r)) => out.push_str(&format!(
                "Source lines: {}\n",
                source_lines(input.source, r.start, r.end)
            )),
            (AnchorConfidence::Ambiguous, _) => out.push_str(&format!(
                "WARNING: this quote matches {} places in the document, so its position is unknown. Do not guess. Report it.\n",
                v.current.candidates
            )),
            _ => out.push_str(
                "WARNING: this quote was not found in the current document. Do not guess. Report it.\n",
            ),
        }
        if v.stale {
            out.push_str("WARNING: this comment was made on an earlier version of the file.\n");
        }
        if !a.anchor.prefix.is_empty() {
            out.push_str("Context before:\n");
            out.push_str(&fenced(&a.anchor.prefix));
        }
        out.push_str("Quote:\n");
        out.push_str(&fenced(&a.anchor.exact));
        if !a.anchor.suffix.is_empty() {
            out.push_str("Context after:\n");
            out.push_str(&fenced(&a.anchor.suffix));
        }
        out.push_str("User instruction (verbatim):\n");
        out.push_str(&fenced(&a.text));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fence_is_longer_than_any_backtick_run_inside() {
        assert_eq!(fenced("plain"), "```\nplain\n```\n");
        assert_eq!(fenced("a ``` b"), "````\na ``` b\n````\n");
        assert_eq!(fenced("``````"), "```````\n``````\n```````\n");
        assert_eq!(fenced("one ` tick"), "```\none ` tick\n```\n");
    }

    #[test]
    fn lines_are_one_based_and_collapse_to_one_when_on_a_single_line() {
        let src = "a\nbb\nccc\n";
        assert_eq!(source_lines(src, 0, 1), "1");
        assert_eq!(source_lines(src, 2, 4), "2");
        assert_eq!(source_lines(src, 0, 5), "1–2");
        assert_eq!(source_lines(src, 0, 9), "1–3");
        // A range ending just after a newline does not claim the next line.
        assert_eq!(source_lines(src, 2, 5), "2");
    }
}
