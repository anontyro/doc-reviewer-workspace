//! Noticing that the active file changed outside the app (F3 spec D24, AT-06).
use llm_review_workspace_lib::document::{open_path, sha256_hex, AppState, DocStatus, ErrorKind};
use std::fs;

mod common;
use common::Temp;

fn active(tag: &str, bytes: &[u8]) -> (Temp, AppState) {
    let t = Temp::new(tag);
    let doc = open_path(&t.file("doc.md", bytes)).unwrap();
    let state = AppState::default();
    state.set(doc).unwrap();
    (t, state)
}

#[test]
fn an_untouched_file_is_unchanged() {
    let (_t, state) = active("check-same", b"# A\n");
    assert_eq!(state.check().unwrap(), DocStatus::Unchanged);
}

#[test]
fn a_file_edited_elsewhere_reports_the_new_hash_and_is_not_touched() {
    let (t, state) = active("check-changed", b"# A\n");
    let path = t.0.join("doc.md");
    fs::write(&path, b"# Edited elsewhere\n").unwrap();
    assert_eq!(
        state.check().unwrap(),
        DocStatus::Changed {
            disk_hash: sha256_hex(b"# Edited elsewhere\n")
        }
    );
    assert_eq!(fs::read(&path).unwrap(), b"# Edited elsewhere\n"); // checking never writes
}

#[test]
fn the_same_bytes_written_again_still_count_as_unchanged() {
    // A touch or a rewrite with identical bytes is not a change the user needs to decide on.
    let (t, state) = active("check-touch", b"# A\n");
    fs::write(t.0.join("doc.md"), b"# A\n").unwrap();
    assert_eq!(state.check().unwrap(), DocStatus::Unchanged);
}

#[test]
fn a_deleted_file_is_missing() {
    let (t, state) = active("check-missing", b"# A\n");
    fs::remove_file(t.0.join("doc.md")).unwrap();
    assert_eq!(state.check().unwrap(), DocStatus::Missing);
}

#[test]
fn with_nothing_open_it_fails_with_no_document() {
    assert_eq!(
        AppState::default().check().unwrap_err().kind,
        ErrorKind::NoDocument
    );
}

#[test]
fn the_result_serialises_with_a_status_tag_the_web_can_switch_on() {
    let json = |s: &DocStatus| serde_json::to_value(s).unwrap();
    assert_eq!(
        json(&DocStatus::Unchanged),
        serde_json::json!({"status": "unchanged"})
    );
    assert_eq!(
        json(&DocStatus::Missing),
        serde_json::json!({"status": "missing"})
    );
    assert_eq!(
        json(&DocStatus::Changed {
            disk_hash: "ab".into()
        }),
        serde_json::json!({"status": "changed", "disk_hash": "ab"})
    );
}
