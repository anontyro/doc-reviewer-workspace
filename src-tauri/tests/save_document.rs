//! Saving the editor's text: exact bytes, the fingerprint check, atomic failure (F3 spec D21, AT-06).
use llm_review_workspace_lib::document::{
    open_path, sha256_hex, AppState, ErrorKind, OpenedDocument, MAX_BYTES,
};
use llm_review_workspace_lib::store::Store;
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, thread, time::Duration};

mod common;
use common::Temp;

const NOW: &str = "2026-11-20T10:00:00Z";

fn fixture(name: &str) -> Vec<u8> {
    fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/markdown")
            .join(name),
    )
    .unwrap()
}

/// A temp folder with `doc.md` holding `bytes`, opened and made the active document.
fn open_active(tag: &str, bytes: &[u8]) -> (Temp, AppState, OpenedDocument) {
    let t = Temp::new(tag);
    let doc = open_path(&t.file("doc.md", bytes)).unwrap();
    let state = AppState::default();
    state.set(doc.clone()).unwrap();
    (t, state, doc)
}

#[test]
fn saving_writes_exactly_the_text_bytes() {
    let (t, state, doc) = open_active("save-exact", b"# Old\n");
    let text = "# New\r\n\r\nmixed é😀 line\nno newline at end";
    let saved = state.save(text, &doc.source_hash).unwrap();
    assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), text.as_bytes());
    assert_eq!(saved.source, text);
    assert_eq!(saved.source_hash, sha256_hex(text.as_bytes()));
}

#[test]
fn saving_unchanged_text_keeps_every_byte_for_lf_crlf_and_no_final_newline() {
    let mut cases = vec![
        ("lf", fixture("small.md")),
        ("crlf", fixture("crlf.md")),
        ("no-final-newline", b"# Title\n\nno newline".to_vec()),
    ];
    for (tag, bytes) in cases.drain(..) {
        let (t, state, doc) = open_active(&format!("save-same-{tag}"), &bytes);
        state.save(&doc.source, &doc.source_hash).unwrap();
        assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), bytes, "{tag}");
    }
    assert!(
        fixture("crlf.md").windows(2).any(|w| w == b"\r\n"),
        "the CRLF fixture must have CRLF"
    );
}

#[test]
fn a_file_changed_on_disk_is_never_overwritten() {
    let (t, state, doc) = open_active("save-conflict", b"# Mine\n");
    let path = t.0.join("doc.md");
    fs::write(&path, b"# Changed elsewhere\n").unwrap();
    let before = fs::metadata(&path).unwrap().modified().unwrap();
    thread::sleep(Duration::from_millis(30));

    let err = state.save("# My edit\n", &doc.source_hash).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Conflict);
    assert_eq!(fs::read(&path).unwrap(), b"# Changed elsewhere\n");
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
    // The active document is unchanged too.
    state
        .with_open(|d| assert_eq!(d.source_hash, doc.source_hash))
        .unwrap();
}

#[test]
fn text_over_ten_mib_is_refused_and_the_file_is_unchanged() {
    let (t, state, doc) = open_active("save-big", b"# Small\n");
    let big = "a".repeat(MAX_BYTES as usize + 1);
    assert_eq!(
        state.save(&big, &doc.source_hash).unwrap_err().kind,
        ErrorKind::TooLarge
    );
    assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), b"# Small\n");
    // Exactly the limit is allowed.
    let exact = "a".repeat(MAX_BYTES as usize);
    assert!(state.save(&exact, &doc.source_hash).is_ok());
}

#[test]
fn permissions_are_kept() {
    let (t, state, doc) = open_active("save-perms", b"# A\n");
    let path = t.0.join("doc.md");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    state.save("# B\n", &doc.source_hash).unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o640
    );
}

#[test]
fn a_failed_write_leaves_the_file_and_no_temp_file() {
    // The folder is read-only, so the temp file cannot be made.
    let (t, state, doc) = open_active("save-readonly", b"# Precious\n");
    fs::set_permissions(&t.0, fs::Permissions::from_mode(0o555)).unwrap();
    let result = state.save("# Would replace\n", &doc.source_hash);
    fs::set_permissions(&t.0, fs::Permissions::from_mode(0o755)).unwrap(); // so cleanup works
    assert_eq!(result.unwrap_err().kind, ErrorKind::Io);
    assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), b"# Precious\n");
    assert_eq!(fs::read_dir(&t.0).unwrap().count(), 1);

    // A folder sits where the temp file would go.
    let (t, state, doc) = open_active("save-blocked", b"# Precious\n");
    let blocker = t.0.join(format!(".doc.md.tmp-{}", std::process::id()));
    fs::create_dir(&blocker).unwrap();
    assert_eq!(
        state.save("# X\n", &doc.source_hash).unwrap_err().kind,
        ErrorKind::Io
    );
    assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), b"# Precious\n");
    assert_eq!(fs::read_dir(&t.0).unwrap().count(), 2); // doc.md and the blocker, nothing else
}

#[test]
fn a_deleted_file_is_reported_as_missing_and_not_recreated() {
    let (t, state, doc) = open_active("save-missing", b"# Gone\n");
    fs::remove_file(t.0.join("doc.md")).unwrap();
    assert_eq!(
        state.save("# X\n", &doc.source_hash).unwrap_err().kind,
        ErrorKind::Missing
    );
    assert!(!t.0.join("doc.md").exists());
}

#[test]
fn the_saved_text_becomes_the_active_document_and_old_comments_go_stale() {
    let (t, state, doc) = open_active("save-active", b"# T\n\nAlpha beta gamma.\n");
    let store = Store::new(t.0.join("annotations"));
    store
        .create(&doc, "Alpha", "", " beta", "note", NOW)
        .unwrap();
    let comments = t.0.join("annotations").join(format!(
        "{}.json",
        serde_json::to_value(&doc.document_id)
            .unwrap()
            .as_str()
            .unwrap()
    ));
    let comments_before = fs::read(&comments).unwrap();

    let saved = state
        .save("# T\n\nAlpha beta delta.\n", &doc.source_hash)
        .unwrap();
    assert_eq!(saved.document_id, doc.document_id);
    assert_ne!(saved.version_id, doc.version_id);
    assert!(saved.html.contains("delta"));
    state
        .with_open(|d| {
            assert_eq!(d.source_hash, saved.source_hash);
            assert_eq!(d.version_id, saved.version_id);
            assert!(d.html.contains("delta"));
        })
        .unwrap();

    let listed = store.list(&saved).unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].stale);
    assert_eq!(fs::read(&comments).unwrap(), comments_before);
}

#[test]
fn saving_with_nothing_open_fails_with_no_document() {
    let err = AppState::default().save("x", "hash").unwrap_err();
    assert_eq!(err.kind, ErrorKind::NoDocument);
}

#[test]
fn two_saves_with_the_same_hash_let_only_the_first_win() {
    let (t, state, doc) = open_active("save-twice", b"# Start\n");
    state.save("# First\n", &doc.source_hash).unwrap();
    let err = state.save("# Second\n", &doc.source_hash).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Conflict);
    assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), b"# First\n");
}
