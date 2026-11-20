# 0001 · A project is a folder with a portable `project.json`, recent projects live in app data, and ids survive moving the folder

**Status:** Agreed · **Work items:** T-008 · **Spec:** `Docs/ProjectsAndPersistence/Specs/2026-11-20-F3-projects-and-persistence.md` D1 to D6, D9, D10

- **Folder.** A project is an ordinary folder holding `.review-workspace/project.json`. Comments for its documents go in
  `.review-workspace/annotations/`, one file per document, created when the first comment is saved. Documents stay in the
  project root where the user can see them. Only added documents are tracked, and the folder is never scanned. Creating a
  project in a folder that has files leaves them alone and tracks none.
- **Portable.** `ProjectFile` holds `schema_version`, `id`, `name`, `created_at`, `updated_at` and the list of documents, and
  no absolute path. The id is `proj_` + 16 hex characters of sha256 of the canonical folder path and `created_at`, made once
  and kept when the folder moves. The unused F1 `Project` entity is gone. Unknown fields are refused, so a file
  from a newer shape fails closed.
- **JSON, not SQLite.** All project data is JSON written with `write_atomic`. A project file, library file or comments
  file that cannot be read, has a refused `schema_version`, or has the wrong shape is never overwritten
  (`store::atomic::read_versioned_json`, shared with the F2 annotation store). SQLite stays an option if querying needs it.
- **Library.** `<app data>/library.json` holds `{ project_id, name, root_path, last_opened_at }` per project, newest
  opened first, then by id, so the file does not depend on the order things happened in. It is a cache: opening a folder
  rebuilds an entry, a folder with an id already in the library moves that entry's `root_path`, and when the name differs
  `project.json` wins. A folder that has gone is listed as `missing` and is never dropped automatically.
- **One active document, two scopes.** The app state holds one active document with a scope: Quick Open (comments in app
  data, exactly as in F2) or Project (comments in the project). Opening a project closes the active document. Every store
  shares one write lock whichever folder it writes. Quick Open comments are not moved into a project.
- **Document ids.** A project document's id is `doc_` + 16 hex characters of sha256 of `<project_id>/<relative_path>`, so
  it and its comments survive moving or syncing the folder. `version_id` and `source_hash` are computed from the bytes as
  in F2, so an edit makes older comments `stale`. Real versions are F4.
- **New error kinds.** `exists`, `not_project`, `missing` and `conflict`. `conflict` is not used until save (R3).

## Why

PRD §8.1 wants user-owned folders that can move, so nothing machine-specific goes in them. One JSON format with the
same atomic, fail-closed rules as F2 keeps recovery simple, and the library can be thrown away without losing a comment.
