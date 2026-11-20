//! Opening a file: ids, errors, byte identity (F2 spec D1 to D5, AT-02).
use llm_review_workspace_lib::document::{open_path, AppState, ErrorKind, MAX_BYTES};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

mod common;
use common::Temp;

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn id(v: impl serde::Serialize) -> String {
    serde_json::to_value(v)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn opens_a_file_with_ids_hash_and_html() {
    let t = Temp::new("open");
    let bytes = "# Title\r\n\r\nSome **text** é😀\r\n".as_bytes();
    let doc = open_path(&t.file("a.md", bytes)).unwrap();
    assert_eq!(doc.name, "a.md");
    assert_eq!(doc.source_hash, sha(bytes));
    assert_eq!(doc.source.as_bytes(), bytes); // CRLF kept, nothing normalised
    assert!(doc.html.contains(">text</strong>"));
    assert!(doc.html.contains("data-sourcepos"));
    assert_eq!(id(&doc.version_id), format!("ver_{}", &sha(bytes)[..16]));
    assert!(id(&doc.document_id).starts_with("doc_"));
    assert_eq!(id(&doc.document_id).len(), "doc_".len() + 16);
}

#[test]
fn same_bytes_share_a_version_id_but_not_a_document_id() {
    let t = Temp::new("ids");
    let a = open_path(&t.file("a.md", b"# Same\n")).unwrap();
    let b = open_path(&t.file("b.md", b"# Same\n")).unwrap();
    assert_eq!(a.version_id, b.version_id);
    assert_ne!(a.document_id, b.document_id);
    let again = open_path(&t.0.join("a.md")).unwrap();
    assert_eq!(a.document_id, again.document_id);
}

#[test]
fn refuses_bad_files_and_leaves_them_untouched() {
    let t = Temp::new("bad");
    let binary = t.file("bin.md", &[0xff, 0xfe, 0x00, 0x80]);
    let err = open_path(&binary).unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotUtf8);
    assert_eq!(fs::read(&binary).unwrap(), [0xff, 0xfe, 0x00, 0x80]);

    let big = t.0.join("big.md");
    fs::File::create(&big)
        .unwrap()
        .set_len(MAX_BYTES + 1)
        .unwrap();
    assert_eq!(open_path(&big).unwrap_err().kind, ErrorKind::TooLarge);
    assert_eq!(fs::metadata(&big).unwrap().len(), MAX_BYTES + 1);

    assert_eq!(
        open_path(&t.0.join("missing.md")).unwrap_err().kind,
        ErrorKind::Io
    );
}

#[test]
fn opening_never_changes_the_file() {
    let t = Temp::new("same");
    let bytes = b"# Keep\n\n   odd   spacing\t\r\nlast line no newline";
    let p = t.file("k.md", bytes);
    open_path(&p).unwrap();
    assert_eq!(fs::read(&p).unwrap(), bytes);
}

#[test]
fn state_reports_no_document_until_one_is_set() {
    let state = AppState::default();
    let err = state.with_open(|d| d.name.clone()).unwrap_err();
    assert_eq!(err.kind, ErrorKind::NoDocument);

    let t = Temp::new("state");
    state
        .set(open_path(&t.file("s.md", b"# S\n")).unwrap())
        .unwrap();
    assert_eq!(state.with_open(|d| d.name.clone()).unwrap(), "s.md");
}

#[test]
fn web_side_gets_no_dialog_fs_or_shell_permission() {
    let caps = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json"),
    )
    .unwrap();
    let json: serde_json::Value = serde_json::from_str(&caps).unwrap();
    assert_eq!(json["permissions"], serde_json::json!(["core:default"]));
}

#[test]
fn csp_keeps_remote_content_blocked() {
    // Rust renders `![x](https://...)` as a real <img>, so only the CSP stops the request.
    let conf =
        fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
            .unwrap();
    let json: serde_json::Value = serde_json::from_str(&conf).unwrap();
    let csp = json["app"]["security"]["csp"]
        .as_str()
        .expect("a CSP must be set");
    assert!(csp.starts_with("default-src 'self'"), "{csp}");
    assert!(
        !csp.contains("http") && !csp.contains('*') && !csp.contains("img-src"),
        "{csp}"
    );
}
