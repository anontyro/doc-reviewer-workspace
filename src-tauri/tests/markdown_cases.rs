//! Runs every case in fixtures/markdown/cases.json through the Rust engine and checks the pass rule (F1 spec D15).
use llm_review_workspace_lib::domain::anchor::AnchorConfidence;
use llm_review_workspace_lib::markdown::{render_markdown, resolve_anchor};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/markdown")
}

fn read(name: &str) -> Vec<u8> {
    fs::read(fixtures().join(name)).unwrap_or_else(|_| panic!("missing fixture {name}"))
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn every_case_resolves_as_expected_and_fixtures_stay_byte_identical() {
    let data: Value = serde_json::from_slice(&read("cases.json")).unwrap();
    let cases = data["cases"].as_array().unwrap();
    let before: Vec<_> = fs::read_dir(fixtures())
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .map(|n| (digest(&read(&n)), n))
        .collect();

    let mut failures = Vec::new();
    for c in cases {
        let id = c["id"].as_str().unwrap();
        let source = String::from_utf8(read(c["file"].as_str().unwrap())).unwrap();
        let got = resolve_anchor(
            &source,
            c["selected"].as_str().unwrap(),
            c["prefix"].as_str().unwrap(),
            c["suffix"].as_str().unwrap(),
        );
        let e = &c["expected"];
        let want_heading: Option<Vec<String>> = e["heading_path"]
            .as_array()
            .map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect());
        let ok = match e["confidence"].as_str().unwrap() {
            "resolved" => {
                let want = e["range_utf8"].as_array().unwrap();
                got.confidence == AnchorConfidence::Resolved
                    && got.source_range.map(|r| (r.start, r.end))
                        == Some((want[0].as_u64().unwrap(), want[1].as_u64().unwrap()))
                    && got.heading_path == want_heading
            }
            _ => {
                got.confidence == AnchorConfidence::Ambiguous
                    && got.source_range.is_none()
                    && got.candidates as u64 == e["candidates"].as_u64().unwrap()
                    && got.heading_path == want_heading
            }
        };
        println!("{} {id}", if ok { "PASS" } else { "FAIL" });
        if !ok {
            failures.push(format!("{id}: got {got:?}, expected {e}"));
        }
    }
    println!(
        "engine B (Rust): {}/{} cases passed",
        cases.len() - failures.len(),
        cases.len()
    );
    assert!(
        failures.is_empty(),
        "failing cases:\n{}",
        failures.join("\n")
    );

    for (hash, name) in before {
        assert_eq!(digest(&read(&name)), hash, "{name} changed");
    }
}

#[test]
fn rendered_blocks_carry_sourcepos() {
    let html = render_markdown(&String::from_utf8(read("small.md")).unwrap());
    assert!(html.contains(r#"<h1 data-sourcepos="1:1-1:16">"#), "{html}");
    assert!(html.contains(r#"data-sourcepos="3:1-3:71""#), "{html}");
}

#[test]
fn hostile_fixture_renders_with_no_executable_content() {
    let html = render_markdown(&String::from_utf8(read("hostile.md")).unwrap()).to_lowercase();
    for bad in [
        "<script",
        "<img",
        "onerror",
        "onclick",
        "javascript:",
        "<a href=\"javascript",
    ] {
        assert!(!html.contains(bad), "found {bad:?} in:\n{html}");
    }
    assert!(html.contains("safe text remains."));
}
