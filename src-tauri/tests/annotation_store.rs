//! The annotation store: persistence, ids, atomic writes, fail-closed loads (F2 spec D15 to D20, AT-01).
use llm_review_workspace_lib::document::{open_path, ErrorKind, OpenedDocument};
use llm_review_workspace_lib::domain::anchor::AnchorConfidence;
use llm_review_workspace_lib::domain::store::AnnotationFile;
use llm_review_workspace_lib::store::annotations::now_rfc3339;
use llm_review_workspace_lib::store::atomic::write_atomic;
use llm_review_workspace_lib::store::Store;
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

mod common;
use common::Temp;

const SRC: &str = "# Title\n\nAlpha beta gamma.\n\nRepeat me. Repeat me.\n\nTail é😀 end.\n";
const NOW: &str = "2026-11-20T10:00:00Z";

struct Fixture {
    t: Temp,
    doc: OpenedDocument,
}

fn fixture(tag: &str) -> Fixture {
    let t = Temp::new(tag);
    let doc = open_path(&t.file("doc.md", SRC.as_bytes())).unwrap();
    Fixture { t, doc }
}

fn store(f: &Fixture) -> Store {
    Store::new(f.t.0.join("annotations"))
}

fn ids(s: &Store, doc: &OpenedDocument) -> Vec<String> {
    s.list(doc)
        .unwrap()
        .iter()
        .map(|v| {
            serde_json::to_value(&v.annotation.id)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect()
}

fn annotation_path(f: &Fixture) -> PathBuf {
    let id = serde_json::to_value(&f.doc.document_id).unwrap();
    f.t.0
        .join("annotations")
        .join(format!("{}.json", id.as_str().unwrap()))
}

#[test]
fn comments_survive_reopening_the_store_unchanged() {
    let f = fixture("persist");
    let text = "  keep the spaces, `backticks` and 😀\nsecond line  ";
    let a = store(&f)
        .create(&f.doc, "Alpha beta", "", " gamma.", text, NOW)
        .unwrap();
    store(&f)
        .create(&f.doc, "é😀", "Tail ", " end.", "emoji", NOW)
        .unwrap();

    let reopened = store(&f); // a new Store on the same folder, as after a restart
    let list = reopened.list(&f.doc).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].annotation, a);
    assert_eq!(list[0].annotation.text, text);
    assert_eq!(list[0].annotation.anchor.heading_path, ["Title"]);
    assert_eq!(list[0].annotation.anchor.source_hash, f.doc.source_hash);
    assert!(!list[0].stale);
    assert_eq!(list[0].current.confidence, AnchorConfidence::Resolved);
}

#[test]
fn ids_count_up_and_a_deleted_id_is_never_reused() {
    let f = fixture("ids");
    let s = store(&f);
    s.create(&f.doc, "Alpha", "", "", "one", NOW).unwrap();
    s.create(&f.doc, "beta", "", "", "two", NOW).unwrap();
    assert_eq!(ids(&s, &f.doc), ["rev_0001", "rev_0002"]);
    s.delete(&f.doc, "rev_0002").unwrap();
    s.create(&f.doc, "gamma", "", "", "three", NOW).unwrap();
    assert_eq!(ids(&s, &f.doc), ["rev_0001", "rev_0003"]);
}

#[test]
fn update_changes_text_and_time_only_and_delete_removes() {
    let f = fixture("edit");
    let s = store(&f);
    let before = s.create(&f.doc, "Alpha", "", "", "old", NOW).unwrap();
    let after = s
        .update(&f.doc, "rev_0001", " new ", "2026-11-21T00:00:00Z")
        .unwrap();
    assert_eq!(after.text, " new ");
    assert_eq!(after.updated_at, "2026-11-21T00:00:00Z");
    assert_eq!(
        (after.created_at.clone(), after.anchor.clone()),
        (before.created_at, before.anchor)
    );
    assert_eq!(
        s.update(&f.doc, "rev_0099", "x", NOW).unwrap_err().kind,
        ErrorKind::Invalid
    );
    s.delete(&f.doc, "rev_0001").unwrap();
    assert!(s.list(&f.doc).unwrap().is_empty());
    assert_eq!(
        s.delete(&f.doc, "rev_0001").unwrap_err().kind,
        ErrorKind::Invalid
    );
}

#[test]
fn create_refuses_ambiguous_orphaned_and_empty_input() {
    let f = fixture("refuse");
    let s = store(&f);
    let ambiguous = s
        .create(&f.doc, "Repeat me.", "", "", "x", NOW)
        .unwrap_err();
    assert_eq!(ambiguous.kind, ErrorKind::Invalid);
    assert!(
        ambiguous.message.contains("2 places"),
        "{}",
        ambiguous.message
    );
    assert_eq!(
        s.create(&f.doc, "nowhere", "", "", "x", NOW)
            .unwrap_err()
            .kind,
        ErrorKind::Invalid
    );
    for blank in ["", "   \n\t"] {
        assert_eq!(
            s.create(&f.doc, "Alpha", "", "", blank, NOW)
                .unwrap_err()
                .kind,
            ErrorKind::Invalid
        );
    }
    assert!(
        !annotation_path(&f).exists(),
        "a refused comment must not create a file"
    );
    // More context makes the same text saveable.
    s.create(&f.doc, "Repeat me.", "", " Repeat me.", "ok", NOW)
        .unwrap();
}

#[test]
fn list_flags_a_changed_file_and_does_not_rewrite_anything() {
    let f = fixture("stale");
    let s = store(&f);
    s.create(&f.doc, "Alpha beta", "", "", "c1", NOW).unwrap();
    s.create(&f.doc, "gamma", "", "", "c2", NOW).unwrap();
    let saved = fs::read(annotation_path(&f)).unwrap();

    let edited = SRC.replace("Alpha beta gamma.", "Alpha beta delta.");
    let doc2 = open_path(&f.t.file("doc.md", edited.as_bytes())).unwrap();
    assert_eq!(doc2.document_id, f.doc.document_id); // same path, new content
    let list = s.list(&doc2).unwrap();
    assert!(list.iter().all(|v| v.stale));
    assert_eq!(list[0].current.confidence, AnchorConfidence::Resolved); // text still there
    assert_eq!(list[1].current.confidence, AnchorConfidence::Orphaned); // text gone, nothing guessed
    assert_eq!(fs::read(annotation_path(&f)).unwrap(), saved);
}

#[test]
fn corrupt_newer_and_foreign_files_are_refused_and_left_alone() {
    let f = fixture("bad");
    let s = store(&f);
    s.create(&f.doc, "Alpha", "", "", "c", NOW).unwrap();
    let good = fs::read_to_string(annotation_path(&f)).unwrap();

    let foreign = good.replace(
        &format!(
            "\"{}\"",
            serde_json::to_value(&f.doc.document_id)
                .unwrap()
                .as_str()
                .unwrap()
        ),
        "\"doc_ffffffffffffffff\"",
    );
    let cases = [
        ("corrupt", "{ not json".to_string()),
        ("no version", "{}".to_string()),
        ("newer major", good.replace("\"1.0.0\"", "\"2.0.0\"")),
        ("foreign", foreign),
    ];
    for (name, bytes) in cases {
        fs::write(annotation_path(&f), &bytes).unwrap();
        assert_eq!(
            s.list(&f.doc).unwrap_err().kind,
            ErrorKind::Io,
            "{name}: list"
        );
        assert_eq!(
            s.create(&f.doc, "beta", "", "", "x", NOW).unwrap_err().kind,
            ErrorKind::Io,
            "{name}: create"
        );
        assert_eq!(
            s.update(&f.doc, "rev_0001", "x", NOW).unwrap_err().kind,
            ErrorKind::Io,
            "{name}: update"
        );
        assert_eq!(
            s.delete(&f.doc, "rev_0001").unwrap_err().kind,
            ErrorKind::Io,
            "{name}: delete"
        );
        assert_eq!(
            fs::read_to_string(annotation_path(&f)).unwrap(),
            bytes,
            "{name}: file changed"
        );
    }
}

#[test]
fn saved_file_matches_the_schema_shape_and_current_version() {
    let f = fixture("shape");
    store(&f).create(&f.doc, "Alpha", "", "", "c", NOW).unwrap();
    let file: AnnotationFile =
        serde_json::from_slice(&fs::read(annotation_path(&f)).unwrap()).unwrap();
    assert_eq!(file.schema_version, "1.0.0");
    assert_eq!(file.next_sequence, 2);
    assert_eq!(file.path, f.doc.path);
}

#[test]
fn write_atomic_replaces_a_file_and_leaves_no_temp_file() {
    let t = Temp::new("atomic");
    let p = t.file("f.json", b"old");
    write_atomic(&p, b"new contents").unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"new contents");
    let names: Vec<_> = fs::read_dir(&t.0)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, ["f.json"]);
}

#[test]
fn write_atomic_leaves_the_old_file_when_the_write_fails() {
    let t = Temp::new("atomic-fail");
    let p = t.file("f.json", b"precious");
    fs::set_permissions(&t.0, fs::Permissions::from_mode(0o555)).unwrap();
    let result = write_atomic(&p, b"would replace");
    fs::set_permissions(&t.0, fs::Permissions::from_mode(0o755)).unwrap(); // so cleanup works
    assert!(result.is_err());
    assert_eq!(fs::read(&p).unwrap(), b"precious");
    assert_eq!(fs::read_dir(&t.0).unwrap().count(), 1);
}

#[test]
fn timestamps_are_rfc3339_utc() {
    let now = now_rfc3339();
    let parsed = time::OffsetDateTime::parse(&now, &time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|e| panic!("{now:?}: {e}"));
    assert!(parsed.offset().is_utc());
    assert!(now.ends_with('Z'), "{now}");
}
