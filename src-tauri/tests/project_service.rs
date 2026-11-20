//! Projects, the library, safe adding and scoped comment stores (F3 spec D1 to D10, R1a).
use llm_review_workspace_lib::document::{open_in_project, ErrorKind, Scope, MAX_BYTES};
use llm_review_workspace_lib::domain::entities::ProjectId;
use llm_review_workspace_lib::domain::project::{LibraryFile, ProjectFile};
use llm_review_workspace_lib::project::Projects;
use llm_review_workspace_lib::store::atomic::write_new;
use llm_review_workspace_lib::store::Store;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

mod common;
use common::Temp;

const T1: &str = "2026-11-20T10:00:00Z";
const T2: &str = "2026-11-20T11:00:00Z";
const T3: &str = "2026-11-20T12:00:00Z";

struct World {
    t: Temp,
    projects: Projects,
}

fn world(tag: &str) -> World {
    let t = Temp::new(tag);
    let projects = Projects::new(t.0.join("appdata").join("library.json"));
    World { t, projects }
}

impl World {
    fn folder(&self, name: &str) -> PathBuf {
        let p = self.t.0.join(name);
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn library(&self) -> LibraryFile {
        serde_json::from_slice(&fs::read(self.t.0.join("appdata/library.json")).unwrap()).unwrap()
    }
}

/// Every file under `dir` with its bytes, to show nothing changed.
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for e in fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(base, &p, out);
            } else {
                let rel = p.strip_prefix(base).unwrap().to_string_lossy().into_owned();
                out.insert(rel, fs::read(&p).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
        let p = e.unwrap().path();
        let dest = to.join(p.file_name().unwrap());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            fs::copy(&p, &dest).unwrap();
        }
    }
}

fn pid(s: &str) -> ProjectId {
    ProjectId::try_from(s.to_string()).unwrap()
}

fn project_file(root: &Path) -> ProjectFile {
    serde_json::from_slice(&fs::read(root.join(".review-workspace/project.json")).unwrap()).unwrap()
}

#[test]
fn create_writes_a_valid_project_and_leaves_other_files_alone() {
    let w = world("create");
    let dir = w.folder("p");
    let other = w.t.file("p/notes.md", b"# unrelated\n");
    let view = w.projects.create(&dir, "  Colony  ", T1).unwrap();

    assert_eq!(view.name, "Colony");
    assert!(view.documents.is_empty(), "existing files are not tracked");
    let file = project_file(&dir);
    assert_eq!(file.name, "Colony");
    assert_eq!(file.schema_version, "1.0.0");
    assert!(file.documents.is_empty());
    assert_eq!(fs::read(other).unwrap(), b"# unrelated\n");
    let names: Vec<_> = snapshot(&dir).into_keys().collect();
    assert_eq!(names, [".review-workspace/project.json", "notes.md"]);
}

#[test]
fn creating_twice_in_one_folder_is_refused_and_changes_nothing() {
    let w = world("twice");
    let dir = w.folder("p");
    w.projects.create(&dir, "One", T1).unwrap();
    let before = snapshot(&dir);
    let err = w.projects.create(&dir, "Two", T2).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Exists);
    assert_eq!(snapshot(&dir), before);
}

#[test]
fn bad_names_are_refused_before_anything_is_written() {
    let w = world("names");
    let dir = w.folder("p");
    for bad in ["", "   ", "tab\there", &"x".repeat(101)] {
        let err = w.projects.create(&dir, bad, T1).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Invalid, "{bad:?}");
    }
    assert!(snapshot(&dir).is_empty());
    assert!(w.projects.create(&dir, &"x".repeat(100), T1).is_ok());
}

#[test]
fn opening_a_folder_that_is_not_a_project_creates_nothing() {
    let w = world("notproject");
    let dir = w.folder("plain");
    w.t.file("plain/a.md", b"# a\n");
    let before = snapshot(&dir);
    let err = w.projects.open(&dir, T1).unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotProject);
    assert_eq!(snapshot(&dir), before);
    assert!(!w.t.0.join("appdata/library.json").exists());
}

#[test]
fn an_unreadable_or_newer_project_file_is_never_overwritten() {
    let w = world("unusable");
    for (tag, bytes) in [
        ("garbage", b"{ not json".to_vec()),
        (
            "newer",
            br#"{"schema_version":"2.0.0","id":"proj_0123456789abcdef","name":"x","created_at":"a","updated_at":"a","documents":[]}"#.to_vec(),
        ),
    ] {
        let dir = w.folder(tag);
        fs::create_dir_all(dir.join(".review-workspace")).unwrap();
        fs::write(dir.join(".review-workspace/project.json"), &bytes).unwrap();
        let err = w.projects.open(&dir, T1).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Io, "{tag}");
        assert!(err.message.contains("unusable"), "{tag}: {}", err.message);
        let err = w.projects.add_document(&dir, &w.t.file("s.md", b"# s\n"), T1).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Io, "{tag}");
        assert_eq!(
            fs::read(dir.join(".review-workspace/project.json")).unwrap(),
            bytes,
            "{tag}"
        );
    }
}

#[test]
fn the_library_lists_newest_first_and_is_stable() {
    let w = world("library");
    let a = w.projects.create(&w.folder("a"), "A", T1).unwrap();
    let b = w.projects.create(&w.folder("b"), "B", T3).unwrap();
    let c = w.projects.create(&w.folder("c"), "C", T2).unwrap();
    let names: Vec<_> = w
        .projects
        .list()
        .unwrap()
        .into_iter()
        .map(|i| i.name)
        .collect();
    assert_eq!(names, ["B", "C", "A"]);

    w.projects.open_at(&a.id, "2026-11-21T00:00:00Z").unwrap(); // opening moves it to the top
    let items = w.projects.list().unwrap();
    assert_eq!(items[0].project_id, a.id);
    assert!(items.iter().all(|i| !i.missing));
    let _ = (b, c);
    // The file on disk is already in that order.
    let on_disk: Vec<_> = w.library().entries.into_iter().map(|e| e.name).collect();
    assert_eq!(on_disk, ["A", "B", "C"]);
}

#[test]
fn a_missing_folder_stays_listed_as_missing_and_a_moved_one_is_found_again() {
    let w = world("moved");
    let from = w.folder("old");
    let view = w.projects.create(&from, "Colony", T1).unwrap();
    w.projects
        .add_document(&from, &w.t.file("d.md", b"# d\n"), T1)
        .unwrap();

    let to = w.t.0.join("new-home");
    copy_dir(&from, &to);
    fs::remove_dir_all(&from).unwrap();

    let items = w.projects.list().unwrap();
    assert_eq!(items.len(), 1);
    assert!(items[0].missing, "gone folder is flagged, not dropped");
    assert_eq!(
        w.projects.open_at(&view.id, T2).unwrap_err().kind,
        ErrorKind::Missing
    );
    assert_eq!(
        w.projects.list().unwrap().len(),
        1,
        "still there after a failed open"
    );

    let reopened = w.projects.open(&to, T2).unwrap();
    assert_eq!(reopened.id, view.id, "the id travels with the folder");
    let items = w.projects.list().unwrap();
    assert_eq!(items.len(), 1);
    assert!(!items[0].missing);
    assert_eq!(
        items[0].root_path,
        fs::canonicalize(&to).unwrap().to_string_lossy()
    );
}

#[test]
fn project_json_wins_over_a_stale_library_name() {
    let w = world("stale-name");
    let dir = w.folder("p");
    let view = w.projects.create(&dir, "Original", T1).unwrap();
    // Someone renames the project in project.json outside the app.
    let mut file = project_file(&dir);
    file.name = "Renamed elsewhere".into();
    fs::write(
        dir.join(".review-workspace/project.json"),
        serde_json::to_string_pretty(&file).unwrap(),
    )
    .unwrap();
    assert_eq!(w.projects.list().unwrap()[0].name, "Original");
    let opened = w.projects.open_at(&view.id, T2).unwrap();
    assert_eq!(opened.name, "Renamed elsewhere");
    assert_eq!(w.projects.list().unwrap()[0].name, "Renamed elsewhere");
}

#[test]
fn an_unreadable_library_is_never_overwritten() {
    let w = world("badlib");
    let lib = w.t.0.join("appdata/library.json");
    fs::create_dir_all(lib.parent().unwrap()).unwrap();
    fs::write(&lib, b"[]").unwrap();
    let dir = w.folder("p");
    let err = w.projects.create(&dir, "P", T1).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Io);
    assert_eq!(fs::read(&lib).unwrap(), b"[]");
}

#[test]
fn add_document_copies_registers_and_leaves_the_source_alone() {
    let w = world("add");
    let root = w.folder("p");
    w.projects.create(&root, "P", T1).unwrap();
    let bytes = "# Doc\r\n\r\nçafé 😀\r\n".as_bytes();
    let source = w.t.file("source.md", bytes);
    let mtime = fs::metadata(&source).unwrap().modified().unwrap();

    let view = w.projects.add_document(&root, &source, T2).unwrap();
    assert_eq!(view.documents.len(), 1);
    assert_eq!(view.documents[0].relative_path, "source.md");
    assert_eq!(fs::read(root.join("source.md")).unwrap(), bytes);
    assert_eq!(project_file(&root).documents[0].added_at, T2);
    assert_eq!(fs::read(&source).unwrap(), bytes);
    assert_eq!(fs::metadata(&source).unwrap().modified().unwrap(), mtime);
    assert!(
        fs::read_dir(&root).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".new-")),
        "no temp file left behind"
    );
}

#[test]
fn a_name_already_in_the_project_is_refused_and_the_existing_file_is_untouched() {
    let w = world("dup");
    let root = w.folder("p");
    w.projects.create(&root, "P", T1).unwrap();
    fs::create_dir_all(w.t.0.join("one")).unwrap();
    fs::create_dir_all(w.t.0.join("two")).unwrap();
    let first = w.t.file("one/x.md", b"first\n");
    let second = w.t.file("two/x.md", b"second\n");
    w.projects.add_document(&root, &first, T1).unwrap();
    let before = snapshot(&root);

    let err = w.projects.add_document(&root, &second, T2).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Exists);
    assert!(err.message.contains("Rename the source file"));
    assert_eq!(snapshot(&root), before);

    // Also when the name is taken by an untracked file the user already has there.
    w.t.file("p/y.md", b"mine\n");
    let other = w.t.file("two/y.md", b"theirs\n");
    assert_eq!(
        w.projects.add_document(&root, &other, T2).unwrap_err().kind,
        ErrorKind::Exists
    );
    assert_eq!(fs::read(root.join("y.md")).unwrap(), b"mine\n");
}

#[test]
fn racing_for_one_name_lets_exactly_one_writer_win_whole() {
    let t = Temp::new("race");
    let target = t.0.join("x.md");
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let target = target.clone();
            std::thread::spawn(move || {
                write_new(&target, format!("writer {i}\n").repeat(5000).as_bytes()).is_ok()
            })
        })
        .collect();
    let wins = handles
        .into_iter()
        .map(|h| h.join().unwrap())
        .filter(|w| *w)
        .count();
    assert_eq!(wins, 1);
    let text = fs::read_to_string(&target).unwrap();
    let first = text.lines().next().unwrap();
    assert!(
        text.lines().all(|l| l == first),
        "a winner's bytes, never a mix"
    );
    assert_eq!(fs::read_dir(&t.0).unwrap().count(), 1, "no temp files left");
}

#[test]
fn bad_sources_are_refused_and_copy_nothing() {
    let w = world("badsrc");
    let root = w.folder("p");
    w.projects.create(&root, "P", T1).unwrap();
    let before = snapshot(&root);

    let binary = w.t.file("pic.md", &[0xff, 0xfe, 0x00, 0x9f]);
    assert_eq!(
        w.projects
            .add_document(&root, &binary, T2)
            .unwrap_err()
            .kind,
        ErrorKind::NotUtf8
    );

    let big = w.t.0.join("big.md");
    fs::write(&big, vec![b'a'; MAX_BYTES as usize + 1]).unwrap();
    assert_eq!(
        w.projects.add_document(&root, &big, T2).unwrap_err().kind,
        ErrorKind::TooLarge
    );

    for name in ["notes.txt", "page.MARKDOWN", ".hidden.md"] {
        let f = w.t.file(name, b"# x\n");
        assert_eq!(
            w.projects.add_document(&root, &f, T2).unwrap_err().kind,
            ErrorKind::Invalid,
            "{name}"
        );
    }
    assert_eq!(snapshot(&root), before);
    assert!(w
        .projects
        .add_document(&root, &w.t.file("UPPER.MD", b"# x\n"), T2)
        .is_ok());
}

#[test]
fn a_file_already_in_the_project_folder_is_registered_without_a_copy() {
    let w = world("inplace");
    let root = w.folder("p");
    w.projects.create(&root, "P", T1).unwrap();
    let existing = w.t.file("p/already.md", b"# here\n");
    let view = w.projects.add_document(&root, &existing, T2).unwrap();
    assert_eq!(view.documents[0].relative_path, "already.md");
    assert_eq!(fs::read(&existing).unwrap(), b"# here\n");
    assert_eq!(
        w.projects
            .add_document(&root, &existing, T3)
            .unwrap_err()
            .kind,
        ErrorKind::Exists,
        "registering twice is a duplicate"
    );
}

#[test]
fn paths_that_could_leave_the_project_are_refused() {
    let w = world("paths");
    let root = w.folder("p");
    let view = w.projects.create(&root, "P", T1).unwrap();
    fs::create_dir_all(root.join("sub")).unwrap();
    w.t.file("p/sub/deep.md", b"# deep\n");
    let outside = w.t.file("outside.md", b"# secret\n");
    std::os::unix::fs::symlink(&outside, root.join("link.md")).unwrap();

    for bad in [
        "../outside.md",
        "sub/deep.md",
        "/etc/hosts",
        ".hidden.md",
        "",
        "a\\b.md",
        "..",
        "x\0.md",
        "link.md",
    ] {
        let err = open_in_project(&root, &view.id, bad).unwrap_err();
        assert!(
            matches!(err.kind, ErrorKind::Invalid | ErrorKind::Missing),
            "{bad:?} -> {:?}",
            err.kind
        );
        assert_ne!(err.kind, ErrorKind::Io, "{bad:?}");
    }
    assert_eq!(
        open_in_project(&root, &view.id, "link.md")
            .unwrap_err()
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        open_in_project(&root, &view.id, "nothing.md")
            .unwrap_err()
            .kind,
        ErrorKind::Missing
    );
}

#[test]
fn comments_live_with_their_scope_and_document_ids_survive_moving_the_project() {
    let w = world("scopes");
    let root = w.folder("p");
    let view = w.projects.create(&root, "P", T1).unwrap();
    w.projects
        .add_document(&root, &w.t.file("d.md", b"# T\n\nAlpha beta.\n"), T1)
        .unwrap();
    let app_dir = w.t.0.join("appdata/annotations");
    let store = Store::new(app_dir.clone());

    let doc = open_in_project(&root, &view.id, "d.md").unwrap();
    let scope = Scope::Project {
        id: view.id.clone(),
        root: root.clone(),
        relative_path: "d.md".into(),
    };
    let a = store
        .for_scope(&scope)
        .create(&doc, "beta", "Alpha ", ".", "hello", T2)
        .unwrap();
    let id = serde_json::to_value(&doc.document_id).unwrap();
    let in_project = root
        .join(".review-workspace/annotations")
        .join(format!("{}.json", id.as_str().unwrap()));
    assert!(in_project.is_file());
    assert!(
        !app_dir.exists(),
        "nothing for a project document goes to app data"
    );

    // A Quick Open document is still stored in app data.
    let quick =
        llm_review_workspace_lib::document::open_path(&w.t.file("q.md", b"# Q\n\nGamma.\n"))
            .unwrap();
    store
        .for_scope(&Scope::QuickOpen)
        .create(&quick, "Gamma", "", ".", "quick", T2)
        .unwrap();
    assert_eq!(fs::read_dir(&app_dir).unwrap().count(), 1);

    // Copy the whole project folder somewhere else: same document id, same comments.
    let moved = w.t.0.join("moved");
    copy_dir(&root, &moved);
    let reopened = w.projects.open(&moved, T3).unwrap();
    assert_eq!(reopened.id, view.id);
    let doc2 = open_in_project(&moved, &reopened.id, "d.md").unwrap();
    assert_eq!(doc2.document_id, doc.document_id);
    let scope2 = Scope::Project {
        id: reopened.id.clone(),
        root: moved.clone(),
        relative_path: "d.md".into(),
    };
    let listed = store.for_scope(&scope2).list(&doc2).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].annotation.id, a.id);
    assert!(!listed[0].stale);
}

#[test]
fn removing_from_the_library_touches_no_file_and_rename_changes_only_the_name() {
    let w = world("remove");
    let root = w.folder("p");
    let view = w.projects.create(&root, "Before", T1).unwrap();
    w.projects
        .add_document(&root, &w.t.file("d.md", b"# d\n"), T1)
        .unwrap();

    let renamed = w.projects.rename(&view.id, "After", T2).unwrap();
    assert_eq!(renamed.name, "After");
    let file = project_file(&root);
    assert_eq!(file.name, "After");
    assert_eq!(file.created_at, T1);
    assert_eq!(file.id, view.id);
    assert_eq!(file.documents.len(), 1);
    assert_eq!(w.projects.list().unwrap()[0].name, "After");
    assert_eq!(
        root.file_name().unwrap(),
        "p",
        "the folder name is unchanged"
    );
    assert_eq!(
        w.projects.rename(&view.id, "  ", T2).unwrap_err().kind,
        ErrorKind::Invalid
    );

    let before = snapshot(&root);
    w.projects.remove(&view.id).unwrap();
    assert!(w.projects.list().unwrap().is_empty());
    assert_eq!(
        snapshot(&root),
        before,
        "every file in the folder is byte-identical"
    );
    w.projects.remove(&pid("proj_00000000000000aa")).unwrap(); // forgetting an unknown id is harmless

    // Opening the folder again brings it back.
    assert_eq!(w.projects.open(&root, T3).unwrap().id, view.id);
    assert_eq!(w.projects.list().unwrap().len(), 1);
}

#[test]
fn error_kinds_use_the_names_the_web_side_expects() {
    for (kind, name) in [
        (ErrorKind::NoDocument, "no_document"),
        (ErrorKind::NotUtf8, "not_utf8"),
        (ErrorKind::TooLarge, "too_large"),
        (ErrorKind::Io, "io"),
        (ErrorKind::Invalid, "invalid"),
        (ErrorKind::Exists, "exists"),
        (ErrorKind::NotProject, "not_project"),
        (ErrorKind::Missing, "missing"),
        (ErrorKind::Conflict, "conflict"),
    ] {
        assert_eq!(serde_json::to_value(kind).unwrap(), name);
    }
}
