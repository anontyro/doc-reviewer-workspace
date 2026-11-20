# Projects and persistence

Work item: F3 (PRD milestone M2, personal alpha). Releases map to these tasks:

| Release | Task |
|---|---|
| R1a · Projects and library (Rust) | T-008 |
| R1b · Home screen (web) | T-008 |
| R2 · Workspace: explorer, tabs, sidebars | T-009 |
| R3 · Source editor and safe save | T-010 |
| R4 · External changes, backups and recovery | T-016 |

Branch: none. Work on `main` until CLAUDE.md says otherwise.
Design: mockups cited by path, not copied: `Docs/01_project_library.png` (home), `Docs/02_markdown_review.png` (workspace layout).
Status: **draft 2026-11-20**. No open questions.
Manual testing: `Docs/ProjectsAndPersistence/Testing/MANUAL-TESTING-F3-projects-and-persistence.md`.
Decisions: `Docs/ProjectsAndPersistence/Decisions/` (README lists every planned record and the package that writes it).

## Goal

Afterwards the user can create or open a project folder, add Markdown documents to it, work across several documents in
tabs, switch between the rendered view and a source editor, edit and save safely, and quit at any moment without losing
comments or edits. This is PRD §5.2. The gate is: **the user can resume an interrupted review and manage a real project
safely.**

| Release | What ships |
|---|---|
| **R1a** | Rust creates and opens project folders, keeps a library of recent projects, and adds documents by copying them in without overwriting. Comments for project documents are stored inside the project. |
| **R1b** | A home screen lists recent projects and offers New project, Open folder and Quick open. |
| **R2** | A workspace with a file explorer, document tabs, and the comment and export panels in collapsible sidebars. |
| **R3** | A rendered/source toggle with a CodeMirror editor, and a save that never overwrites a file changed on disk. |
| **R4** | Changes made outside the app are noticed, the old bytes are backed up before every overwrite, and unsaved edits survive a crash. |

## Background (read 2026-11-20)

- F2 is done and merged. Rust holds one open document in `AppState` (`src-tauri/src/document.rs`) and every command acts
  on it: `open_markdown`, `resolve_selection`, `create_annotation`, `list_annotations`, `update_annotation`,
  `delete_annotation`, `generate_feedback` (`src-tauri/src/commands.rs`). Errors are `CommandError { kind, message }`
  (`document.rs`, mirrored by `ErrorKind` in `src/api.ts:23`).
- Comments live in one JSON file per document under `<app data>/annotations/<document_id>.json` (F2 decision 0003).
  `store::Store` does create, list, update and delete behind an in-process mutex, and `store::atomic::write_atomic`
  does the temp-file, `sync_all`, rename write. `document_id` is a hash of the canonical path, so a moved file is a new document.
- `src-tauri/src/domain/entities.rs` already has `Project` (with an absolute `root_path`) and `LibraryEntry`
  (with a `local_index_path`). Neither is written anywhere yet. `ProjectId` is `proj_`. `domain/mod.rs` emits one schema
  and `schemas/v1/domain.schema.json` is guarded by `tests/schema_drift.rs`. `src/domain/validate.ts` lists
  `ENTITY_NAMES`. Fixtures in `fixtures/domain/{valid,invalid}.json`.
- The web side talks to Rust only through `src/api.ts` (F2 D6). `src/reader/Reader.tsx` owns an Open button, the
  article, the comment panel, the floating menu and the export panel. `src/review/fakeBackend.ts` fakes every command in
  Vitest, and `e2e/fakeTauri.ts` does the same for Playwright (F2 decision 0005). Both must change when a command does.
- The CSP is `default-src 'self'; style-src 'self'` (`src-tauri/tauri.conf.json`), and a test pins it
  (`tests/open_document.rs`). `capabilities/default.json` is only `core:default`.
- PRD §8.1 to §8.4: projects are ordinary folders, imports are copied by default, metadata sits in a hidden
  `.review-workspace/`, writes are atomic, a file changed on disk is never silently overwritten (AT-06), and deleting a
  project must not remove user files silently.
- PRD §15.3 questions this feature settles: storage format, Quick Open without a project, project deletion,
  copy-by-default and duplicate names (see D3, D5, D8, D9).

## Decisions

### R1a · Projects and library (Rust), plus decisions shared by every release

> **R1a · T-008 · ~22 files: ~10 new, ~12 modified · packages P1–P2**
>
> The user can create a project in any folder, open one again, see recent projects, rename or forget one, and add a
> Markdown file to it. In the code, project and library types join the domain model, and a `project` module owns the
> folder layout, the library file and safe copying.

- **D1 · Project folder.** A project is an ordinary folder that contains `.review-workspace/project.json`. The same
  folder holds `annotations/`, and later `backups/` and `drafts/` (created when first needed). Nothing else is created.
  Documents stay where the user can see them, in the project root. Only explicitly added documents are tracked, and
  the folder is never scanned.
- **D2 · `ProjectFile` is portable.** `project.json` holds `ProjectFile { schema_version, id, name, created_at,
  updated_at, documents }`, with `documents` a list of `{ relative_path, format, added_at }`. It holds no absolute path,
  so a project folder can be moved or synced. `id` is `proj_` + the first 16 hex characters of sha256 of the canonical
  folder path plus `created_at`, made once and kept when the folder moves. The unused F1 `Project` entity is replaced by
  `ProjectFile`. It was never written to disk, so no migration is needed. `schema_version` is `1.0.0`.
- **D3 · Storage format: JSON, no SQLite.** All project data is JSON files in the project folder, written atomically
  like F2 (`write_atomic`), and never overwritten when unreadable or from a newer major version. This settles the PRD §15.3
  storage question for the alpha. SQLite stays a later option if querying needs it.
- **D4 · Library.** `<app data>/library.json` holds `LibraryFile { schema_version, entries }` with each entry
  `{ project_id, name, root_path, last_opened_at }`. It is a cache of what the user opened, and can be rebuilt by opening
  the folders again. The F1 `LibraryEntry` is replaced by this shape. Entries are sorted by `last_opened_at`
  newest first, then `project_id`. When `project.json` and the library disagree on the name, `project.json` wins and the
  library is corrected on open. An entry whose folder is gone stays, and is listed as `missing`. It is never removed
  automatically. Opening a folder whose `proj_` id is already in the library updates that entry's `root_path`, so a moved
  project is found again.
- **D5 · Commands.** All errors use `CommandError`.
  - `create_project(name)` shows a native folder dialog (`tauri-plugin-dialog`, Rust API only, as in F2) and returns `None` on
    cancel. It makes `.review-workspace/project.json` in the chosen folder. It refuses a folder that already holds one
    (`exists`). It leaves any files already in the folder alone and tracks none of them.
  - `open_project()` shows the folder dialog and opens a folder that holds `project.json`, or fails with `not_project`.
  - `open_project_at(project_id)` opens a library entry without a dialog, or fails with `missing`.
  - `list_library()`, `rename_project(project_id, name)`, `remove_from_library(project_id)`.
  - `add_document()` shows a file dialog for one `.md` file and returns the project's updated document list (D7).
  - `open_project_document(relative_path)` reads the file from disk, renders it, makes it the active document and returns
    an `OpenedDocument` (R2 uses it).
  - `open_markdown` stays as Quick Open (D6).
  The project commands return `ProjectView { id, name, root_path, documents: [{ relative_path, name }] }`.
  Names are 1 to 100 characters, trimmed, with no control characters.
- **D6 · One active document, two scopes.** `AppState` still holds a single active `OpenedDocument`, now with a scope:
  `QuickOpen` or `Project { id, root, relative_path }`. Every existing command works on the active document unchanged.
  Comments for a `QuickOpen` document stay in `<app data>/annotations/` exactly as in F2. Comments for a project
  document live in `<root>/.review-workspace/annotations/`. There is no promotion of Quick Open comments into a project
  in F3. This settles the PRD §15.3 Quick Open question: not saved into projects. All stores share one write lock, so
  two stores never write at the same moment.
- **D7 · Safe adding.** `add_document` copies the chosen file into the project root and never overwrites:
  - It checks the same rules as opening: UTF-8, at most 10 MiB, extension `.md` (any case).
  - The copy is written to a temp file in the project root and then linked into place with a link that fails if the
    name exists, so an existing file is never replaced, even by a race. The temp file is then removed.
  - A name that already exists in the project is refused with `exists`, and the message tells the user to rename
    the source file first. Nothing is renamed automatically. This settles the PRD §15.3 duplicate-name question.
  - A file already inside the project root with that name is registered without a copy.
  - The source file is never modified or moved.
- **D8 · Remove and rename.** Removing a project deletes only its library entry. The folder, its documents and
  `.review-workspace/` stay on disk, and the confirmation says so. F3 has no action that deletes project contents. This
  settles the PRD §15.3 deletion question. Rename changes `name` in `project.json` and the library only. The folder name is
  not changed.
- **D9 · Safe paths and identity.** `relative_path` is a single file name: no separators, no `..`, no leading `.`.
  After joining it to the root, the canonical parent must equal the canonical root, so a symlink cannot reach outside the project.
  Anything else is refused with `invalid`. `document_id` for a project document is `doc_` + the first 16 hex characters of
  sha256 of `<project_id>/<relative_path>`, so it survives moving the project folder. `version_id` and `source_hash` are
  computed as in F2. Editing changes them, and the existing `stale` flag tells the user which comments were made against
  older text. F4 adds real versions.
- **D10 · New error kinds.** `exists`, `not_project`, `missing` and (R3) `conflict` join `ErrorKind` in Rust and in
  `src/api.ts`. A test pins that the two lists match.

### R1b · Home screen (web)

> **R1b · T-008 · ~9 files: ~5 new, ~4 modified · package P3**
>
> The app starts on a home screen with recent projects, New project, Open folder and Quick open. In the code, `api.ts` wraps
> the project commands and a small `project` component set shows the library.

- **D11 · Home.** The home screen follows `Docs/01_project_library.png` in structure only: a heading, the actions New
  project, Open folder and Quick open, and a list of recent projects. A card shows the name, the folder path, how long
  ago it was opened, and a `Folder missing` badge when D4 says so. Each card has Open, Rename and Remove. Remove asks
  first and says the folder stays on disk. There are no comment counts or review-state badges in F3.
- **D12 · No router.** The app has two states, home and workspace, held in React state. The window title and focus move
  to the new view on change. A command error shows as an alert and leaves the user where they were.

### R2 · Workspace: explorer, tabs, sidebars

> **R2 · T-009 · ~14 files: ~8 new, ~6 modified · package P4**
>
> Opening a project shows its documents in a left explorer, opens them in tabs, and keeps comments and export in a right
> sidebar. Both sidebars collapse. In the code, `Reader` no longer owns the Open button and receives its document.

- **D13 · Layout.** Left sidebar: the project name, the document list and an Add document button. Centre: a tab strip and
  the document. Right sidebar: the comment panel and the export panel from F2. Both sidebars collapse with a button and a
  shortcut (`Cmd+\` left, `Cmd+Shift+\` right, recommended). Collapsed state lives in React state only.
- **D14 · Tabs live in the web, the active document lives in Rust.** Selecting a tab or an explorer entry calls
  `open_project_document`. Rust re-reads the file from disk each time, so a tab always shows the file as it is now. The
  comment panel reloads on every activation. Tabs use `role=tablist`, arrow keys move between them, and the active tab
  is announced. Closing the active tab activates its neighbour. Closing the last tab shows an empty state.
- **D15 · Quick Open in the workspace.** Quick Open shows a single-document workspace with no explorer, and labels the
  document as not in a project. Its comments stay in app data (D6).
- **D16 · Reader takes a document.** `Reader` receives an `OpenedDocument` as a prop. The F2 Open button moves to the
  home screen and the explorer. All F2 reader behaviour (selection, menu, shortcuts, highlights, inert links) is unchanged and its
  tests still pass.

### R3 · Source editor and safe save

> **R3 · T-010 · ~19 files: ~11 new, ~8 modified · packages P5–P6**
>
> A toggle switches the active document between rendered and source. The source view is a CodeMirror editor. Saving
> writes the file atomically and refuses to overwrite a file that has changed on disk. In the code, Rust gets a
> `save_document` command and the web gets the editor.

- **D17 · Editor.** CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `lang-markdown`, `language`, `search`) is the
  source editor. It bundles locally and makes no network request. It gives Markdown highlighting, undo and redo, and find
  (`Cmd+F`). Two small commands add `Cmd+B` (bold) and `Cmd+I` (italic) by wrapping the selection. The dependency list is
  recorded in decision 0004.
- **D18 · The CSP must hold.** CodeMirror adds `<style>` elements at run time, which `style-src 'self'` blocks. In this
  order: (1) set `EditorView.cspNonce` and give the CSP a matching `style-src 'nonce-…'` if Tauri can inject one; (2) if
  that does not work, widen to `style-src 'self' 'unsafe-inline'`, keeping `script-src` and `default-src` at `'self'`
  and recording the reason in decision 0004 (inline styles cannot run script). Remote content stays blocked either way,
  and the pinned CSP test is updated to the chosen policy.
- **D19 · Toggle never writes.** Switching between rendered and source makes no write and no Rust call that changes a
  file (AT-02). A test asserts no `save_document` call happens on toggle. The editor holds an unsaved buffer per tab
  in web state, and a dirty tab shows a marker.
- **D20 · Line endings are preserved.** The editor is set to the file's own line separator. A file that is all `\n` or all
  `\r\n` is edited with that separator, and its trailing newline is left as it is. A file with mixed endings or a lone
  `\r` opens read-only in source view with a message saying why, so no edit can change bytes the user did not touch.
  This extends F1 decision 0005 (CRLF is never normalised).
- **D21 · `save_document(text, expected_hash)`.** Rust compares the sha256 of the file's bytes on disk with
  `expected_hash` (the `source_hash` the editor loaded from). If they differ it returns `conflict` and writes nothing.
  Otherwise it refuses text over 10 MiB, writes atomically, keeps the original file's permissions, re-reads
  the file, replaces the active document (new `source_hash`, `version_id`, `html`) and returns the new
  `OpenedDocument`. It does not touch the annotation files (D22).
- **D22 · Comments after an edit.** Nothing is re-anchored (PRD §6.2, F4). Rust's `current` and `stale` fields show
  what still matches. In the rendered view, Comment is disabled while the tab is dirty, with the message "Save first: comments
  attach to the saved text". Rendered view of a dirty tab shows the last saved text, with a banner saying so.
- **D23 · Save and close.** `Cmd+S` saves. A save error is shown and the buffer is kept. Closing a dirty tab asks to keep
  editing or discard, with an in-app dialog.

### R4 · External changes, backups and recovery

> **R4 · T-016 · ~17 files: ~9 new, ~8 modified · packages P7–P8**
>
> The app notices when a file changes outside it, keeps a backup of the old bytes before every overwrite, and brings back
> unsaved edits after a crash. In the code, Rust adds change checks, backups and drafts, and the web adds the banner,
> conflict dialog and recovery prompt.

- **D24 · Change check.** `check_document()` hashes the active file's bytes and returns `unchanged`, `changed` (with
  the new `disk_hash`) or `missing`. The web calls it when the window regains focus and just before a save. There is
  no file watcher. A clean tab that has `changed` shows a banner with Reload. Nothing reloads silently. A `missing`
  file blocks saving, keeps the buffer, and says where the file was.
- **D25 · Conflict choices.** A dirty tab whose file `changed`, or a save that returns `conflict`, opens a dialog with three
  actions: **Keep editing** (the default, nothing is written), **Load the disk version** (the user's text is first
  saved as a backup, then the tab reloads), **Overwrite the disk version** (needs a second confirmation, and saves with
  the new `disk_hash` as `expected_hash`, so the disk bytes are backed up first by D26). Overwriting is never the default and
  never happens without a click (AT-06).
- **D26 · Backups.** Before `save_document` replaces a file, Rust copies the old bytes to
  `<root>/.review-workspace/backups/<document_id>/<yyyymmddThhmmssZ>-<hash8>.md` (for Quick Open files,
  `<app data>/backups/<document_id>/`). A backup with the same hash as the newest is skipped. The newest 20 per
  document are kept and older ones are pruned only after the save succeeds. If the backup cannot be written, the save
  is refused and nothing is changed.
- **D27 · Drafts.** While a tab is dirty the web calls `save_draft(text, base_hash)` two seconds after the last edit. Rust
  writes `.review-workspace/drafts/<document_id>.json` atomically as `DraftFile { schema_version, document_id,
  base_hash, text, saved_at }`, a new domain type with schema, TS type and fixtures. A successful save, or choosing
  to discard, deletes the draft (`clear_draft`). Activating a document calls `read_draft()`, and if there is one the web
  asks Restore or Discard. Restoring loads the draft as the buffer with `expected_hash = base_hash`, so a file that has
  changed since the draft still goes through D25 instead of being overwritten.
- **D28 · Crash safety.** A write that fails leaves the target untouched. When a project opens, leftover
  `.<name>.tmp-*` files inside `.review-workspace/` are deleted. Temp files that a crash left in the project root are not
  deleted, because that folder is the user's. The explorer hides dot-files, so they do not show up.
- **D29 · Dependencies.** Web: the CodeMirror packages in D17. Rust: none. Decisions 0004 and 0005 list them.

## Non-goals

- Drag and drop of files or folders. It needs a Tauri window-event path and its own validation, so it gets its own
  decision later. Adding documents is by picker only.
- Subfolders, recursive scanning, renaming, moving or deleting documents, deleting a project's contents, project-wide search.
- Document versions, review rounds beyond `rnd_0001`, reimport, re-anchoring after edits, multi-document export, export
  scope selection (F4).
- Comment counts and review-state badges on the home screen. PDF (F5). A rendered preview of unsaved text.
- A file watcher, SQLite, single-instance protection, themes, signing and packaging.

## Lanes

| Lane | Touched | Checks |
|---|---|---|
| `web` | yes | `pnpm run check` · `pnpm run test:e2e` for the packages that name it |
| `rust` | yes | from `src-tauri/`: `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test` |
| `docs` | yes | no automated check. A reviewer reads against the acceptance criteria. |

## Packages

Waves:

| Wave | Packages | Release | Note |
|---|---|---|---|
| 1 | P1 | R1a (T-008) | domain types first |
| 2 | P2 | R1a (T-008) | |
| 3 | P3, P5 | R1b (T-008), R3 (T-010) | parallel, web and Rust |
| 4 | P4 | R2 (T-009) | after P3 |
| 5 | P6, P7 | R3 (T-010), R4 (T-016) | parallel, web and Rust |
| 6 | P8 | R4 (T-016) | after P6 and P7 |

Packages that share a wave share no files.

Shared acceptance for every package:

- The lane checks pass for its files, measured against the baseline.
- No test is deleted or skipped to pass a check.
- New logic ships with tests in the same package that would fail if the behaviour broke (real inputs, edge and error
  paths), using temp folders and never the user's real files. The whole lane suite is green.
- User files are never modified except by `save_document` after its checks (D21, D25), and `add_document` never overwrites (D7).
- Any package that changes a command's name, arguments or result also updates `src/api.ts`, `src/review/fakeBackend.ts`
  and `e2e/fakeTauri.ts` in the same package, or reports `blocked` if it does not own them.
- Every new dependency is listed in a decision record. A package that needs one that is not listed reports `blocked`.
- The work is audited (spec-plan step 10) before F3 is closed. There is no branch or PR (CLAUDE.md).

### P1 · Rust: project, library and draft types (R1a · T-008, wave 1)
- Lane: `rust` (and `web` for generated types)
- ownedFiles:
  - `src-tauri/src/domain/entities.rs` (`Project` and `LibraryEntry` replaced)
  - `src-tauri/src/domain/project.rs` (new, `ProjectFile`, `ProjectDocument`, `LibraryFile`, `DraftFile`)
  - `src-tauri/src/domain/mod.rs`
  - `schemas/v1/domain.schema.json`
  - `src/domain/generated/domain.schema.d.ts`
  - `src/domain/validate.ts`
  - `src/domain/validate.test.ts`
  - `fixtures/domain/valid.json`
  - `fixtures/domain/invalid.json`
- Acceptance criteria:
  1. `ProjectFile`, `LibraryFile` and `DraftFile` exist in Rust with `schema_version`, and `Project` and `LibraryEntry` are replaced as D2 and D4 say. `ProjectFile` has no absolute path field.
  2. `cargo run --bin gen_schemas` output is committed and `tests/schema_drift.rs` passes. `pnpm run gen:types` output is committed.
  3. `ENTITY_NAMES` lists the new names, and `fixtures/domain` has a valid and several invalid cases for each (bad id prefix, missing `schema_version`, wrong version major, extra field).
  4. The web validator accepts every valid fixture and rejects every invalid one, and a Rust test does the same.
  5. `check_schema_version` is applied to all three new types and refuses a `2.x.y` file.

### P2 · Rust: project service, library and scoped stores (R1a · T-008, wave 2)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/document.rs`
  - `src-tauri/src/project/mod.rs` (new)
  - `src-tauri/src/project/library.rs` (new)
  - `src-tauri/src/project/service.rs` (new)
  - `src-tauri/src/project/paths.rs` (new)
  - `src-tauri/src/store/annotations.rs`
  - `src-tauri/src/store/atomic.rs`
  - `src-tauri/tests/project_service.rs` (new)
  - `src-tauri/tests/common/mod.rs`
  - `Docs/ProjectsAndPersistence/Decisions/0001-project-folder-library-and-identity.md` (new)
  - `Docs/ProjectsAndPersistence/Decisions/0002-safe-adding-removal-and-paths.md` (new)
- Acceptance criteria:
  1. Creating a project in a temp folder writes a `project.json` that validates against the schema, and creating again in the same folder fails with `exists` and changes nothing. Existing files in the folder are untouched and not tracked.
  2. Opening a folder without `project.json` fails with `not_project`. A `project.json` that cannot be parsed, or has a `2.x.y` version, is never overwritten and returns `io` with a message.
  3. The library is written atomically, sorted as D4 says, survives a missing folder (listed as `missing`, not removed), updates `root_path` when the same `proj_` id is opened from a new place, and `project.json` wins over a stale library name.
  4. `add_document` copies a UTF-8 `.md` file into the root and registers it. A name that already exists fails with `exists` and the existing file's bytes are unchanged, also when two adds race. A non-UTF-8 file, an over-limit file and a non-`.md` file are refused. The source file's bytes and mtime are unchanged.
  5. `relative_path` values with `..`, a separator, a leading dot, or a symlink that leaves the project are refused with `invalid`, and tests cover each.
  6. A comment created on a project document is stored under `<root>/.review-workspace/annotations/`, and one on a Quick Open document under app data. `document_id` is the same after the project folder is copied elsewhere.
  7. Removing from the library leaves the folder and every file in it byte-identical. Rename changes only `name`, in `project.json` and the library.
  8. `ErrorKind` has `exists`, `not_project`, `missing` and `conflict`, and the F2 tests still pass unchanged.
  9. Decisions 0001 and 0002 are written, `Agreed`, and match the code.

### P3 · Web: typed API and home screen (R1b · T-008, wave 3)
- Lane: `web`
- ownedFiles:
  - `src/api.ts`
  - `src/App.tsx`
  - `src/App.test.tsx`
  - `src/project/Home.tsx` (new)
  - `src/project/useLibrary.ts` (new)
  - `src/project/Home.test.tsx` (new)
  - `src/styles.css`
  - `src/review/fakeBackend.ts`
  - `e2e/fakeTauri.ts`
  - `e2e/home.spec.ts` (new)
- Acceptance criteria:
  1. `api.ts` wraps every project command with typed results, and `ErrorKind` in TS equals the Rust list (a test reads the Rust source or a shared fixture and compares).
  2. The home screen lists library entries newest first, with the `Folder missing` badge, and offers New project, Open folder and Quick open. A cancelled dialog changes nothing.
  3. Remove asks first, says the folder stays on disk, and calls `remove_from_library` only after confirming. Rename calls `rename_project`.
  4. A command error is shown as an alert and the user stays on the home screen.
  5. `fakeBackend.ts` and `e2e/fakeTauri.ts` fake the new commands, and `pnpm run test:e2e` passes for the home flows in Chromium and WebKit.
  6. All existing web tests still pass.

### P4 · Web: workspace, explorer, tabs and sidebars (R2 · T-009, wave 4)
- Lane: `web`
- ownedFiles:
  - `src/App.tsx`
  - `src/reader/Reader.tsx`
  - `src/reader/Reader.test.tsx`
  - `src/workspace/Workspace.tsx` (new)
  - `src/workspace/Explorer.tsx` (new)
  - `src/workspace/Tabs.tsx` (new)
  - `src/workspace/useTabs.ts` (new)
  - `src/workspace/workspace.css` (new)
  - `src/workspace/workspace.test.tsx` (new)
  - `src/review/fakeBackend.ts`
  - `e2e/fakeTauri.ts`
  - `e2e/workspace.spec.ts` (new)
  - `Docs/ProjectsAndPersistence/Decisions/0003-workspace-tabs-and-active-document.md` (new)
- Acceptance criteria:
  1. Opening a project shows its documents in the explorer. Dot-files and temp files never appear. Add document adds one and shows it. An `exists` error is shown and the list is unchanged.
  2. Selecting a document opens it in a tab and calls `open_project_document`. Selecting an open tab calls it again, so the tab shows the file's current text and the comment panel reloads.
  3. Tabs use `role=tablist`, arrow keys move focus, closing the active tab activates its neighbour, and closing the last shows the empty state.
  4. Each sidebar collapses and expands by button and by shortcut, and the document keeps its scroll position.
  5. `Reader` takes the document as a prop and all F2 reader and review tests pass with only the mounting changed. The inert-link test still passes.
  6. Quick Open shows one document with no explorer and a "not in a project" label.
  7. Playwright covers: opening a project, switching tabs keeps each tab's comments, and a comment made in one tab is not shown in another.
  8. Decision 0003 is written, `Agreed`, and matches the code.

### P5 · Rust: save_document with a fingerprint check (R3 · T-010, wave 3)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/document.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/tests/save_document.rs` (new)
  - `src-tauri/tests/common/mod.rs`
- Acceptance criteria:
  1. `save_document` with a matching `expected_hash` writes the new text, and the file's bytes equal the text's UTF-8 bytes exactly. Text that is byte-identical to the file leaves the bytes identical, for LF, CRLF and no-trailing-newline fixtures from `fixtures/markdown/`.
  2. A non-matching `expected_hash` returns `conflict` and the file's bytes and mtime are unchanged (AT-06).
  3. Text over 10 MiB is refused with `too_large` and the file is unchanged.
  4. The file's permissions are kept, a failed write (target made unwritable, or a directory in the way) leaves the file intact, and no temp file is left behind.
  5. The active document is replaced with the new hash, version id and html, and `list_annotations` then marks comments made against the old text `stale` without changing the annotation file.
  6. `save_document` fails with `no_document` when nothing is open.

### P6 · Web: CodeMirror editor, toggle and save (R3 · T-010, wave 5)
- Lane: `web` (and `rust` for the CSP test)
- ownedFiles:
  - `package.json`
  - `pnpm-lock.yaml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tests/open_document.rs`
  - `src/api.ts`
  - `src/editor/SourceEditor.tsx` (new)
  - `src/editor/lineEndings.ts` (new)
  - `src/editor/commands.ts` (new)
  - `src/editor/editor.css` (new)
  - `src/editor/editor.test.tsx` (new)
  - `src/editor/lineEndings.test.ts` (new)
  - `src/workspace/Workspace.tsx`
  - `src/workspace/useTabs.ts`
  - `src/workspace/Tabs.tsx`
  - `src/reader/Reader.tsx`
  - `src/review/fakeBackend.ts`
  - `e2e/fakeTauri.ts`
  - `e2e/editor.spec.ts` (new)
  - `Docs/ProjectsAndPersistence/Decisions/0004-source-editor-line-endings-and-csp.md` (new)
- Acceptance criteria:
  1. A toggle switches rendered and source for the active tab, and a test shows toggling many times makes no `save_document` call and no other write command (AT-02).
  2. Typing marks the tab dirty. `Cmd+S` calls `save_document` with the editor's text and the `source_hash` it loaded from, and on success clears the dirty marker and shows the new rendered text.
  3. A save error (including `conflict`) is shown, and the buffer and dirty marker stay.
  4. LF and CRLF files round-trip: opening and saving without edits sends text equal to the original string. A file with mixed endings or a lone `\r` opens read-only with the message from D20, and no save is possible.
  5. `Cmd+B` and `Cmd+I` wrap the selection, `Cmd+F` opens find, and undo and redo work.
  6. While a tab is dirty, Comment is disabled in the rendered view with the D22 message, and the banner is shown.
  7. Closing a dirty tab asks first, and Keep editing leaves it open and unchanged.
  8. The editor loads and works under the CSP chosen by D18. `tauri.conf.json` and the pinned CSP test agree, and remote content is still blocked. The decision says which option was used and why. Playwright covers toggle, edit and save in both engines.
  9. Decision 0004 is written, `Agreed`, and lists the CodeMirror packages.

### P7 · Rust: change check, backups and drafts (R4 · T-016, wave 5)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/document.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/project/backup.rs` (new)
  - `src-tauri/src/project/drafts.rs` (new)
  - `src-tauri/src/project/mod.rs`
  - `src-tauri/src/project/service.rs`
  - `src-tauri/tests/change_check.rs` (new)
  - `src-tauri/tests/backups_and_drafts.rs` (new)
  - `src-tauri/tests/common/mod.rs`
  - `Docs/ProjectsAndPersistence/Decisions/0005-change-check-and-backups.md` (new)
- Acceptance criteria:
  1. `check_document` returns `unchanged`, `changed` with the new hash, and `missing` for an untouched file, a file edited outside the app, and a deleted file.
  2. `save_document` copies the old bytes to the backup folder before writing, in the project for project documents and in app data for Quick Open. The backup's bytes equal the old file. A save whose bytes match the newest backup adds no new one.
  3. If the backup cannot be written the save fails, and the file and annotations are unchanged.
  4. After 25 saves only the newest 20 backups remain, and pruning never runs when the save failed.
  5. `save_draft` writes an atomic `DraftFile` that validates against the schema. `read_draft` returns it, `clear_draft` removes it, and a draft whose file is unreadable or from a newer major is left in place and reported, never overwritten.
  6. Crash cases: a draft written and the process "killed" before any save is still readable on the next open. A leftover `.x.tmp-123` inside `.review-workspace/` is deleted when the project opens. One in the project root is left alone.
  7. A save that is refused for `conflict` writes no backup, no draft change and no file change.
  8. Decision 0005 is written, `Agreed`, and matches the code.

### P8 · Web: change banner, conflict dialog and recovery (R4 · T-016, wave 6)
- Lane: `web`
- ownedFiles:
  - `src/api.ts`
  - `src/workspace/Workspace.tsx`
  - `src/workspace/useTabs.ts`
  - `src/workspace/Conflict.tsx` (new)
  - `src/workspace/Recovery.tsx` (new)
  - `src/workspace/useChangeCheck.ts` (new)
  - `src/workspace/recovery.test.tsx` (new)
  - `src/editor/SourceEditor.tsx`
  - `src/review/fakeBackend.ts`
  - `e2e/fakeTauri.ts`
  - `e2e/recovery.spec.ts` (new)
  - `Docs/ProjectsAndPersistence/Decisions/0006-conflict-choices-and-draft-recovery.md` (new)
  - `Docs/ProjectsAndPersistence/Decisions/README.md`
- Acceptance criteria:
  1. When the window regains focus, `check_document` runs. A clean tab with `changed` shows a banner with Reload, and nothing reloads until it is clicked. A `missing` file shows a message and disables save.
  2. A dirty tab with `changed`, or a save that returns `conflict`, opens the dialog. Keep editing is the default and writes nothing. Load the disk version backs up the user's text and then reloads. Overwrite needs a second confirmation, and a test shows no path reaches `save_document` with the new `disk_hash` without it (AT-06).
  3. A dirty buffer calls `save_draft` two seconds after the last edit (fake timers) and never while clean. A successful save or Discard calls `clear_draft`.
  4. Activating a document that has a draft shows Restore or Discard. Restore loads the text as a dirty buffer with `expected_hash = base_hash`, and saving it when the file has changed since goes to the conflict dialog.
  5. Playwright covers: the conflict dialog choices, and a restored draft.
  6. Decision 0006 is written, `Agreed`, and matches the code. The README's list is complete.

## Follow-ups

- Drag and drop of documents (own decision).
- Temp files left in the project root by a crash are never cleaned (D28). Revisit when F4 adds `versions/`.
- Two app instances can still overwrite each other's comment changes (F2 decision 0003). The same applies to project data.
- Highlight performance with many comments on a large file is still unmeasured (T-020).

## Resolved questions

- **Storage format → D3.** JSON files in the project folder.
- **Project deletion → D8.** Remove from the library only. F3 never deletes project contents.
- **Duplicate names → D7.** Refuse and ask for another name.
- **Editor → D17.** CodeMirror 6.
- **Quick Open without a project → D6.** Comments stay in app data. No promotion.
