//! Builds each case in fixtures/export/inputs.json and compares it byte for byte with its `.expected.md`
//! (F2 spec D21 to D24).
use llm_review_workspace_lib::domain::anchor::{Anchor, AnchorConfidence};
use llm_review_workspace_lib::domain::entities::{
    Annotation, AnnotationAction, AnnotationId, AnnotationStatus, RoundId,
};
use llm_review_workspace_lib::feedback::{build_feedback, FeedbackInput};
use llm_review_workspace_lib::store::annotations::view;
use llm_review_workspace_lib::store::AnnotationView;
use serde_json::Value;
use std::{fs, path::PathBuf};

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/export")
}

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap().to_string()
}

fn annotation(a: &Value) -> Annotation {
    let status = match a["status"].as_str().unwrap() {
        "open" => AnnotationStatus::Open,
        "resolved" => AnnotationStatus::Resolved,
        _ => AnnotationStatus::Superseded,
    };
    Annotation {
        schema_version: "1.0.0".into(),
        id: AnnotationId::try_from(text(a, "id")).unwrap(),
        round_id: RoundId::try_from("rnd_0001".to_string()).unwrap(),
        action_type: AnnotationAction::Comment,
        text: text(a, "text"),
        replacement_text: None,
        anchor: Anchor {
            exact: text(a, "exact"),
            prefix: text(a, "prefix"),
            suffix: text(a, "suffix"),
            heading_path: a["heading_path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s.as_str().unwrap().to_string())
                .collect(),
            source_range: None,
            source_hash: text(a, "source_hash"),
            confidence: AnchorConfidence::Resolved,
        },
        status,
        created_at: "2026-11-20T10:00:00Z".into(),
        updated_at: "2026-11-20T10:00:00Z".into(),
    }
}

fn views(case: &Value) -> Vec<AnnotationView> {
    case["annotations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| {
            view(
                &text(case, "source"),
                &text(case, "source_hash"),
                annotation(a),
            )
        })
        .collect()
}

fn build(case: &Value, views: &[AnnotationView]) -> String {
    build_feedback(&FeedbackInput {
        name: case["name"].as_str().unwrap(),
        version_id: case["version_id"].as_str().unwrap(),
        source_hash: case["source_hash"].as_str().unwrap(),
        source: case["source"].as_str().unwrap(),
        annotations: views,
    })
}

fn cases() -> Vec<Value> {
    serde_json::from_slice(&fs::read(dir().join("inputs.json")).unwrap()).unwrap()
}

#[test]
fn every_case_matches_its_expected_file_byte_for_byte() {
    for case in cases() {
        let id = case["id"].as_str().unwrap();
        let expected = fs::read_to_string(dir().join(format!("{id}.expected.md")))
            .unwrap_or_else(|_| panic!("missing fixtures/export/{id}.expected.md"));
        let got = build(&case, &views(&case));
        assert_eq!(got, expected, "case {id}");
    }
}

#[test]
fn same_input_gives_same_bytes_in_any_input_order() {
    for case in cases() {
        let mut v = views(&case);
        let first = build(&case, &v);
        assert_eq!(first, build(&case, &v), "{}: not repeatable", case["id"]);
        v.reverse();
        assert_eq!(
            first,
            build(&case, &v),
            "{}: depends on input order",
            case["id"]
        );
    }
}

#[test]
fn only_open_comments_appear_in_source_order() {
    let case = cases()
        .into_iter()
        .find(|c| c["id"] == "ordering-and-excluded")
        .unwrap();
    let out = build(&case, &views(&case));
    let headings: Vec<&str> = out.lines().filter(|l| l.starts_with("### ")).collect();
    assert_eq!(
        headings,
        [
            "### rev_0003 — COMMENT",
            "### rev_0005 — COMMENT",
            "### rev_0001 — COMMENT"
        ]
    );
    assert!(!out.contains("done already") && !out.contains("old idea"));
}

#[test]
fn unresolved_and_stale_comments_are_warned_and_have_no_guessed_lines() {
    let case = cases()
        .into_iter()
        .find(|c| c["id"] == "ambiguous-orphaned-stale")
        .unwrap();
    let out = build(&case, &views(&case));
    let section = |id: &str| {
        let start = out.find(&format!("### {id}")).unwrap();
        out[start..].split("\n### ").next().unwrap().to_string()
    };
    for id in ["rev_0001", "rev_0002"] {
        let s = section(id);
        assert!(s.contains("WARNING"), "{id}");
        assert!(
            !s.contains("Source lines:"),
            "{id} must not give a position"
        );
    }
    assert!(section("rev_0001").contains("matches 2 places"));
    assert!(section("rev_0002").contains("not found"));
    let stale = section("rev_0003");
    assert!(stale.contains("earlier version") && stale.contains("Source lines: 5"));
}

#[test]
fn comment_text_with_backticks_and_non_bmp_is_verbatim_inside_its_fence() {
    let case = cases()
        .into_iter()
        .find(|c| c["id"] == "backticks-and-unicode")
        .unwrap();
    let out = build(&case, &views(&case));
    let verbatim = case["annotations"][0]["text"].as_str().unwrap();
    // The comment has a run of four backticks, so its fence is five.
    assert!(
        out.contains(&format!("`````\n{verbatim}\n`````\n")),
        "{out}"
    );
    assert!(out.contains("é😀 sentence."));
}

#[test]
fn no_open_comments_still_gives_the_instructions() {
    let case = cases()
        .into_iter()
        .find(|c| c["id"] == "no-annotations")
        .unwrap();
    let out = build(&case, &views(&case));
    assert!(out.contains("## Instructions") && out.contains("There are no comments."));
    assert!(!out.contains("###"));
}
