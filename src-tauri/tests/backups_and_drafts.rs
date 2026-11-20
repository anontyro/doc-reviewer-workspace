//! Backups before every overwrite, drafts and crash safety (F3 spec D24 to D28).
use llm_review_workspace_lib::document::{
    open_in_project, open_path, sha256_hex, AppState, ErrorKind, OpenedDocument, Scope,
};
use llm_review_workspace_lib::domain::entities::{DocumentId, ProjectId};
use llm_review_workspace_lib::domain::project::DraftFile;
use llm_review_workspace_lib::project::backup::{Backups, KEEP};
use llm_review_workspace_lib::project::drafts::Drafts;
use llm_review_workspace_lib::project::Projects;
use llm_review_workspace_lib::store::Store;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

mod common;
use common::Temp;

const NOW: &str = "2026-11-20T10:00:00Z";

fn project_id() -> ProjectId {
    ProjectId::try_from("proj_0123456789abcdef".to_string()).unwrap()
}

/// A project folder with `doc.md`, opened as the active document, plus a separate app-data folder.
struct Env {
    root: Temp,
    app: Temp,
    state: AppState,
    doc: OpenedDocument,
    scope: Scope,
    backups: Backups,
}

fn project_env(tag: &str, bytes: &[u8]) -> Env {
    let root = Temp::new(tag);
    let app = Temp::new(&format!("{tag}-app"));
    root.file("doc.md", bytes);
    let doc = open_in_project(&root.0, &project_id(), "doc.md").unwrap();
    let scope = Scope::Project {
        id: project_id(),
        root: fs::canonicalize(&root.0).unwrap(),
        relative_path: "doc.md".into(),
    };
    let state = AppState::default();
    state.set_in(doc.clone(), scope.clone()).unwrap();
    let backups = Backups::new(app.0.join("backups"));
    Env {
        root,
        app,
        state,
        doc,
        scope,
        backups,
    }
}

impl Env {
    fn save(
        &self,
        text: &str,
        hash: &str,
        now: &str,
    ) -> Result<OpenedDocument, llm_review_workspace_lib::document::CommandError> {
        self.state.save(text, hash, &self.backups, now)
    }
    fn backup_dir(&self) -> PathBuf {
        self.backups.dir(&self.scope, &self.doc.document_id)
    }
    fn backup_names(&self) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(self.backup_dir())
            .map(|d| {
                d.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    }
}

#[test]
fn a_save_keeps_the_old_bytes_in_the_project_backup_folder() {
    let e = project_env("bk-project", b"# Old\r\nbytes\r\n");
    e.save("# New\n", &e.doc.source_hash, NOW).unwrap();
    let names = e.backup_names();
    assert_eq!(names.len(), 1);
    assert_eq!(
        names[0],
        format!("20261120T100000Z-{}.md", &e.doc.source_hash[..8])
    );
    assert!(e.backup_dir().starts_with(
        fs::canonicalize(&e.root.0)
            .unwrap()
            .join(".review-workspace/backups")
    ));
    assert_eq!(
        fs::read(e.backup_dir().join(&names[0])).unwrap(),
        b"# Old\r\nbytes\r\n"
    );
    assert_eq!(fs::read(e.root.0.join("doc.md")).unwrap(), b"# New\n");
}

#[test]
fn a_quick_open_file_is_backed_up_in_app_data() {
    let t = Temp::new("bk-quick");
    let app = Temp::new("bk-quick-app");
    let doc = open_path(&t.file("doc.md", b"old")).unwrap();
    let state = AppState::default();
    state.set(doc.clone()).unwrap();
    let backups = Backups::new(app.0.join("backups"));
    state.save("new", &doc.source_hash, &backups, NOW).unwrap();
    let dir = backups.dir(&Scope::QuickOpen, &doc.document_id);
    assert!(dir.starts_with(app.0.join("backups")));
    let only: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
    assert_eq!(only.len(), 1);
    assert_eq!(fs::read(only[0].path()).unwrap(), b"old");
    assert!(
        !t.0.join(".review-workspace").exists(),
        "nothing is added beside a Quick Open file"
    );
}

#[test]
fn saving_the_same_bytes_twice_adds_no_second_backup() {
    let e = project_env("bk-dup", b"# Same\n");
    let first = e
        .save("# Same\n", &e.doc.source_hash, "2026-11-20T10:00:01Z")
        .unwrap();
    e.save("# Same\n", &first.source_hash, "2026-11-20T10:00:02Z")
        .unwrap();
    assert_eq!(e.backup_names().len(), 1);
}

#[test]
fn if_the_backup_cannot_be_written_nothing_changes() {
    let e = project_env("bk-fail", b"# Precious\n");
    let comments = Store::new(e.app.0.join("annotations"));
    comments
        .create(&e.doc, "Precious", "", "", "note", NOW)
        .unwrap();
    let comment_file = fs::read_dir(e.app.0.join("annotations"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let before = fs::read(&comment_file).unwrap();
    // A regular file where the backup folder should be.
    fs::create_dir_all(e.root.0.join(".review-workspace")).unwrap();
    fs::write(e.root.0.join(".review-workspace/backups"), b"in the way").unwrap();

    let err = e
        .save("# Would replace\n", &e.doc.source_hash, NOW)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Io);
    assert_eq!(fs::read(e.root.0.join("doc.md")).unwrap(), b"# Precious\n");
    assert_eq!(fs::read(&comment_file).unwrap(), before);
    e.state
        .with_open(|d| assert_eq!(d.source_hash, e.doc.source_hash))
        .unwrap();
}

#[test]
fn after_25_saves_only_the_newest_20_backups_remain() {
    let e = project_env("bk-prune", b"v0\n");
    let mut hash = e.doc.source_hash.clone();
    for i in 1..=25 {
        let saved = e
            .save(
                &format!("v{i}\n"),
                &hash,
                &format!("2026-11-20T10:00:{i:02}Z"),
            )
            .unwrap();
        hash = saved.source_hash;
    }
    let names = e.backup_names();
    assert_eq!(names.len(), KEEP);
    // The backups are of v5..v24 (the old bytes of saves 6 to 25), so v0 to v4 are gone.
    let kept: Vec<Vec<u8>> = names
        .iter()
        .map(|n| fs::read(e.backup_dir().join(n)).unwrap())
        .collect();
    assert_eq!(kept.first().unwrap(), b"v5\n");
    assert_eq!(kept.last().unwrap(), b"v24\n");
}

#[test]
fn pruning_does_not_run_when_the_save_failed() {
    let t = Temp::new("bk-noprune");
    let app = Temp::new("bk-noprune-app");
    let doc = open_path(&t.file("doc.md", b"# A\n")).unwrap();
    let state = AppState::default();
    state.set(doc.clone()).unwrap();
    let backups = Backups::new(app.0.join("backups"));
    let dir = backups.dir(&Scope::QuickOpen, &doc.document_id);
    fs::create_dir_all(&dir).unwrap();
    for i in 0..22 {
        fs::write(
            dir.join(format!("20261120T09{i:02}00Z-aaaaaaaa.md")),
            b"old",
        )
        .unwrap();
    }
    // The document's folder is read-only: the backup is made, then the write fails.
    fs::set_permissions(&t.0, fs::Permissions::from_mode(0o555)).unwrap();
    let result = state.save("# B\n", &doc.source_hash, &backups, NOW);
    fs::set_permissions(&t.0, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(result.unwrap_err().kind, ErrorKind::Io);
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 23);
    assert_eq!(fs::read(t.0.join("doc.md")).unwrap(), b"# A\n");
}

#[test]
fn a_conflict_writes_no_backup_no_draft_change_and_no_file_change() {
    let e = project_env("bk-conflict", b"# Mine\n");
    let drafts = Drafts::new(e.app.0.join("drafts"));
    drafts
        .save(
            &e.scope,
            &e.doc.document_id,
            "my draft",
            &e.doc.source_hash,
            NOW,
        )
        .unwrap();
    let draft_path = e
        .root
        .0
        .join(".review-workspace/drafts")
        .join(format!("{}.json", String::from(e.doc.document_id.clone())));
    let draft_before = fs::read(&draft_path).unwrap();
    fs::write(e.root.0.join("doc.md"), b"# Changed elsewhere\n").unwrap();

    let err = e.save("# My edit\n", &e.doc.source_hash, NOW).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Conflict);
    assert!(e.backup_names().is_empty());
    assert!(!e.backup_dir().exists());
    assert_eq!(fs::read(&draft_path).unwrap(), draft_before);
    assert_eq!(
        fs::read(e.root.0.join("doc.md")).unwrap(),
        b"# Changed elsewhere\n"
    );
}

#[test]
fn overwriting_after_a_conflict_backs_up_the_disk_version() {
    let e = project_env("bk-overwrite", b"# Mine\n");
    fs::write(e.root.0.join("doc.md"), b"# Their edit\n").unwrap();
    // The user chose Overwrite: the expected hash is now the disk hash.
    e.save("# My edit\n", &sha256_hex(b"# Their edit\n"), NOW)
        .unwrap();
    let names = e.backup_names();
    assert_eq!(names.len(), 1);
    assert_eq!(
        fs::read(e.backup_dir().join(&names[0])).unwrap(),
        b"# Their edit\n"
    );
}

fn doc_id(e: &Env) -> DocumentId {
    e.doc.document_id.clone()
}

#[test]
fn a_draft_is_written_read_and_cleared() {
    let e = project_env("draft-basic", b"# A\n");
    let drafts = Drafts::new(e.app.0.join("drafts"));
    assert_eq!(drafts.read(&e.scope, &doc_id(&e)).unwrap(), None);
    drafts
        .save(
            &e.scope,
            &doc_id(&e),
            "unsaved \u{1F600}\r\ntext",
            &e.doc.source_hash,
            NOW,
        )
        .unwrap();

    let path = e
        .root
        .0
        .join(".review-workspace/drafts")
        .join(format!("{}.json", String::from(doc_id(&e))));
    let on_disk: DraftFile = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap(); // deny_unknown_fields
    assert_eq!(on_disk.schema_version, "1.0.0");
    assert_eq!(on_disk.saved_at, NOW);
    let draft = drafts.read(&e.scope, &doc_id(&e)).unwrap().unwrap();
    assert_eq!(draft.text, "unsaved \u{1F600}\r\ntext");
    assert_eq!(draft.base_hash, e.doc.source_hash);

    drafts.clear(&e.scope, &doc_id(&e)).unwrap();
    assert!(!path.exists());
    drafts.clear(&e.scope, &doc_id(&e)).unwrap(); // clearing nothing is fine
}

#[test]
fn a_draft_survives_a_restart() {
    let e = project_env("draft-crash", b"# A\n");
    Drafts::new(e.app.0.join("drafts"))
        .save(
            &e.scope,
            &doc_id(&e),
            "typed before the crash",
            &e.doc.source_hash,
            NOW,
        )
        .unwrap();
    // A new Drafts and a new open of the project, as after the process was killed.
    let reopened = open_in_project(&e.root.0, &project_id(), "doc.md").unwrap();
    let draft = Drafts::new(e.app.0.join("drafts"))
        .read(&e.scope, &reopened.document_id)
        .unwrap()
        .unwrap();
    assert_eq!(draft.text, "typed before the crash");
}

#[test]
fn a_quick_open_draft_lives_in_app_data() {
    let app = Temp::new("draft-quick-app");
    let id = DocumentId::try_from("doc_0123456789abcdef".to_string()).unwrap();
    let drafts = Drafts::new(app.0.join("drafts"));
    drafts.save(&Scope::QuickOpen, &id, "x", "h", NOW).unwrap();
    assert!(app.0.join("drafts/doc_0123456789abcdef.json").is_file());
}

#[test]
fn an_unreadable_or_newer_draft_is_reported_and_never_overwritten_or_deleted() {
    let e = project_env("draft-bad", b"# A\n");
    let drafts = Drafts::new(e.app.0.join("drafts"));
    drafts
        .save(&e.scope, &doc_id(&e), "good", &e.doc.source_hash, NOW)
        .unwrap();
    let path = e
        .root
        .0
        .join(".review-workspace/drafts")
        .join(format!("{}.json", String::from(doc_id(&e))));
    let good = fs::read_to_string(&path).unwrap();
    let cases = [
        ("corrupt", "{ nope".to_string()),
        ("newer major", good.replace("\"1.0.0\"", "\"2.0.0\"")),
    ];
    for (name, bytes) in cases {
        fs::write(&path, &bytes).unwrap();
        assert_eq!(
            drafts.read(&e.scope, &doc_id(&e)).unwrap_err().kind,
            ErrorKind::Io,
            "{name}: read"
        );
        assert_eq!(
            drafts
                .save(&e.scope, &doc_id(&e), "new", "h", NOW)
                .unwrap_err()
                .kind,
            ErrorKind::Io,
            "{name}: save"
        );
        assert_eq!(
            drafts.clear(&e.scope, &doc_id(&e)).unwrap_err().kind,
            ErrorKind::Io,
            "{name}: clear"
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            bytes,
            "{name}: file changed"
        );
    }
}

#[test]
fn a_draft_over_10_mib_is_refused() {
    let app = Temp::new("draft-big");
    let id = DocumentId::try_from("doc_0123456789abcdef".to_string()).unwrap();
    let big = "a".repeat(10 * 1024 * 1024 + 1);
    let err = Drafts::new(app.0.join("drafts"))
        .save(&Scope::QuickOpen, &id, &big, "h", NOW)
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::TooLarge);
}

fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir).map(|d| d.flatten().count()).unwrap_or(0)
}

#[test]
fn opening_a_project_deletes_leftover_temp_files_inside_review_workspace_only() {
    let folder = Temp::new("crash-tmp");
    let app = Temp::new("crash-tmp-app");
    let projects = Projects::new(app.0.join("library.json"));
    let view = projects.create(&folder.0, "P", NOW).unwrap();
    let meta = folder.0.join(".review-workspace");
    fs::create_dir_all(meta.join("annotations")).unwrap();
    let inside = [
        meta.join(".project.json.tmp-123"),
        meta.join("annotations/.doc_x.json.tmp-9"),
    ];
    for p in &inside {
        fs::write(p, b"half").unwrap();
    }
    let in_root = folder.0.join(".doc.md.tmp-5");
    fs::write(&in_root, b"user folder").unwrap();
    let real = meta.join("annotations/doc_x.json");
    fs::write(&real, b"{}").unwrap();
    let before = count_files(&meta);

    projects.open(&folder.0, NOW).unwrap();
    assert!(inside.iter().all(|p| !p.exists()));
    assert!(in_root.exists(), "the project root belongs to the user");
    assert!(real.exists() && meta.join("project.json").exists());
    assert_eq!(count_files(&meta), before - 1);

    // The same cleanup runs when opened from the library.
    fs::write(&inside[0], b"half").unwrap();
    projects.open_at(&view.id, NOW).unwrap();
    assert!(!inside[0].exists());
}
