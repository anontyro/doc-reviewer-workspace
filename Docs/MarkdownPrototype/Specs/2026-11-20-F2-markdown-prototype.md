# Markdown review prototype

Work item: F2 (PRD milestone M1). Releases map to these tasks:

| Release | Task |
|---|---|
| R1a · Open and render (Rust) | T-004 |
| R1b · Reader view (web) | T-004 |
| R2 · Select and comment | T-005 |
| R3 · Persist comments | T-006 |
| R4 · Copy feedback | T-007 |

Branch: `feature/F2-markdown-prototype`.
Design: mockups cited by path, not copied: `Docs/02_markdown_review.png`, `Docs/03_inline_annotation.png`, `Docs/04_export_preview.png`.
Status: **draft 2026-11-20**. Q1 is open and blocks only R2's highlight (D12).
Manual testing: `Docs/MarkdownPrototype/Testing/MANUAL-TESTING-F2-markdown-prototype.md`.
Decisions: `Docs/MarkdownPrototype/Decisions/` (README lists every planned record and the package that writes it).

## Goal

Afterwards the user can open a Markdown file, select a passage, attach a freeform comment, close and reopen the app and
find the comment still there, and copy a deterministic Markdown feedback prompt to paste into an LLM chat. This is PRD
§5.1, the vertical slice, for one document with no project.

| Release | What ships |
|---|---|
| **R1a** | Rust opens a chosen Markdown file and renders it with the engine F1 chose. The spike code becomes the real `markdown` module. |
| **R1b** | The web app shows the rendered file in a reader. The TypeScript engine is deleted. |
| **R2** | Select text, see a floating menu, write a comment with mouse or keyboard. Comments sit in a side panel with highlights, in memory only. |
| **R3** | Comments are saved to disk atomically and come back after a restart, with their anchor state. |
| **R4** | An export panel shows the exact feedback prompt and copies it to the clipboard. |

## Background (read 2026-11-20)

- F1 is done. Decision FoundationSpike 0004 chose Rust (comrak) for rendering and anchor resolution. 0005 fixed
  `source_range` as UTF-8 byte offsets. The report lists the files to delete: `src/spike/{markdown,resolve,spike.test,SpikeView}`
  and `bundle.test.ts`, keep `capture.ts`, and promote `src-tauri/src/spike/`.
- `src-tauri/src/spike/resolve.rs` exports `resolve_anchor(source, selected, prefix, suffix) -> ResolvedAnchor`
  (`confidence`, `heading_path`, `source_range`, `candidates`). `render.rs` exports `render_markdown`.
  `src-tauri/tests/spike_cases.rs` runs all 28 shared cases from `fixtures/markdown/cases.json`.
- `src/spike/capture.ts` turns a DOM range into `{selected, prefix, suffix}` (40 chars of context, one block only,
  soft breaks read as spaces).
- Domain types already exist (`src-tauri/src/domain/`): `Annotation`, `Anchor`, `AnnotationAction`,
  `AnnotationStatus`, typed ids (`doc_`, `ver_`, `rnd_`, `rev_`). IDs are validated but not generated. `created_at`
  and `updated_at` are unparsed strings (a `shortcut:` comment in `entities.rs`).
- `check_schema_version` accepts `1.x.y` and refuses others. `schemas/v1/domain.schema.json` is generated and a drift
  test guards it. `pnpm run gen:types` regenerates `src/domain/generated/`.
- `capabilities/default.json` grants only `core:default`. The CSP is `default-src 'self'; style-src 'self'`.
- `PRD §6.3`: identity is the exact quote plus context and heading path. Ranges and line numbers are helpers only.
  PRD §7.1: exports are deterministic, preserve comment text verbatim and disclose ambiguity.
  PRD §8.4: writes are atomic and never silently overwrite.

## Decisions

### R1a · Open and render (Rust), plus decisions shared by every release

> **R1a · T-004 · ~14 files: ~6 new, ~4 modified, ~4 moved or deleted · package P1**
>
> The app can open a Markdown file through a native dialog, hash it and render it, and resolve a text selection against
> it. In the code, the spike engine moves out of `spike/` into a real `markdown` module and its commands lose the
> debug-only gate.

- **D1 · Opening a file.** The command `open_markdown` shows a native open dialog from Rust, using
  `tauri-plugin-dialog` through its Rust API only. `capabilities/default.json` gets no `dialog`, `fs` or `shell`
  permission, so the web side cannot open files itself. It returns `None` if the user cancels. A file that is not
  UTF-8, or is over 10 MiB, is refused with a typed error and nothing else happens.
- **D2 · Opened document.** The result is `OpenedDocument { path, name, document_id, version_id, source_hash, source,
  html }` (serialised in `snake_case`). The same data is held in app state as the single open document. Opening never
  writes to the file.
- **D3 · Ids.** `document_id` is `doc_` + the first 16 hex characters of sha256 of the canonical absolute path.
  `version_id` is `ver_` + the first 16 hex characters of sha256 of the file bytes. `source_hash` is the full sha256 hex
  of the bytes. A renamed or moved file is a new document in F2. Project-level identity is F3.
- **D4 · Engine promoted, behaviour unchanged.** `src-tauri/src/markdown/` holds the engine B code. `render_markdown`
  and `resolve_anchor` keep their signatures and results. comrak safe mode stays the only sanitiser (FoundationSpike
  decision 0004), and the hostile fixture test must still pass. The 28-case test moves with it and still prints its
  totals.
- **D5 · Commands.** `open_markdown` and `resolve_selection(selected, prefix, suffix) -> ResolvedAnchor` (against the
  open document, error `no_document` if none). The spike commands are removed. Errors are `CommandError { kind, message }`
  with `kind` one of `no_document`, `not_utf8`, `too_large`, `io`, `invalid`. Every later command uses the same shape.

### R1b · Reader view (web)

> **R1b · T-004 · ~18 files: ~7 new, ~5 modified, ~6 deleted · package P2**
>
> The user clicks Open, picks a file and reads it rendered. In the code the web side gets one typed wrapper over the
> Rust commands, a reader component and the capture helper, and loses engine A and the spike view.

- **D6 · One door to Rust.** The web side calls Rust only through `src/api.ts`, with typed wrappers and the
  `CommandError` shape. Tests may fake the IPC boundary with `@tauri-apps/api/mocks` and nothing else.
- **D7 · Reader.** The reader renders `OpenedDocument.html` with `dangerouslySetInnerHTML`, and only that string. It
  never edits the document source and has no source toggle (T-010, F3).
- **D8 · CSP unchanged.** `style-src 'self'`. Anything positioned at run time (the floating menu) uses CSSOM
  (`element.style.top = ...`, or React's `style` prop), never a `style` attribute written into markup.
- **D9 · Deleted code.** `src/spike/markdown.ts`, `resolve.ts`, `SpikeView.tsx`, `spike.test.ts` and `bundle.test.ts`
  are deleted with the engine they test. The behaviour they covered is covered by the Rust tests. `capture.ts` moves to
  `src/review/capture.ts` with its own test, and `jsdom` stays as the component-test environment. The remark,
  rehype and unified packages are removed.

### R2 · Select and comment

> **R2 · T-005 · ~10 files: ~8 new, ~2 modified · package P3**
>
> The user selects text and a floating menu appears. They write a comment with mouse or keyboard and it shows in a side
> panel, with the passage highlighted. Comments live in memory until R3.

- **D10 · Menu.** After a non-empty selection inside one block of the reader (by mouse or keyboard), a floating menu
  appears below the selection (above it if there is no room), and never covers the selected text. It offers
  **Comment** only. The model still stores `action_type`, so the other five values need no migration later.
- **D11 · Keyboard.** Recommended shortcuts (PRD §6.1, not confirmed): `Cmd+Shift+M` opens the composer for the current
  selection, `Cmd+Enter` saves, `Esc` dismisses and puts focus and selection back in the document. The menu and
  composer are reachable with Tab and have visible focus. A selection survives opening the composer.
- **D12 · Fail closed.** A comment can only be created when `resolve_selection` returns `resolved`. For `ambiguous` the
  composer says the selection matches N places and asks for more text. For `orphaned` or a selection across blocks it
  says why, and creates nothing.
- **D13 · Highlight.** Highlights use the CSS Custom Highlight API. A range is built only if prefix + exact + suffix
  occurs exactly once in the DOM. Otherwise there is no highlight, and the panel still shows the quote. Clicking a
  comment in the panel scrolls to and focuses its passage. Without the API there is no highlight and nothing else breaks (Q1).
- **D14 · In-memory first.** R2 keeps comments in `useAnnotations` with temporary ids. R3 replaces its storage with the
  Rust commands and keeps the hook's interface.

### R3 · Persist comments

> **R3 · T-006 · ~21 files: ~11 new, ~10 modified · packages P4–P5**
>
> Comments are saved to disk and come back after a restart, whichever way the app was closed. In the code, Rust owns a
> small annotation store with atomic writes, and the panel shows whether each comment still points at its passage.

- **D15 · Storage.** One JSON file per document at `<app data dir>/annotations/<document_id>.json`. It holds
  `AnnotationFile { schema_version, document_id, path, next_sequence, annotations }`. `AnnotationFile` is a new
  domain type in Rust, with a generated schema and TS type, like every persisted type. `schema_version` is `1.0.0`.
  F3 decides the project storage format and may replace this.
- **D16 · Atomic and fail closed.** A save writes a temp file in the same folder, calls `sync_all`, then renames. A file
  that cannot be parsed, or whose version `check_schema_version` refuses, is never overwritten: the command returns an
  error and the file is left alone. No annotation file is touched when a write cannot complete.
- **D17 · Ids and round.** An annotation id is `rev_` + a four-digit sequence taken from `next_sequence`, which only
  grows, so a deleted id is never reused. The round is always `rnd_0001`. The anchor's `source_hash` records the version
  it was made against.
- **D18 · Timestamps.** `created_at` and `updated_at` are RFC 3339 UTC, set by Rust with the `time` crate. This closes
  the F1 `shortcut:` for annotations.
- **D19 · Commands.** `create_annotation(selected, prefix, suffix, text)`, `list_annotations()`,
  `update_annotation(id, text)` and `delete_annotation(id)`. `create_annotation` resolves the selection itself against
  the open document and builds the `Anchor` in Rust, and refuses anything but `resolved`. The UI never sends a range.
  Text is stored verbatim. Text that is empty or only whitespace is refused.
- **D20 · Changed files, no silent repair.** `list_annotations` returns each annotation with `current` (a fresh
  `ResolvedAnchor` against the open text) and `stale` (the stored `source_hash` differs from the open file's). Nothing in
  the stored file changes, and nothing is re-anchored automatically (PRD §6.2). Re-anchoring belongs to F4.

### R4 · Copy feedback

> **R4 · T-007 · ~16 files: ~12 new, ~4 modified · packages P6–P7**
>
> The user opens an export panel, sees the exact prompt and copies it. In the code, a pure Rust function builds the
> prompt, with snapshot files for every case.

- **D21 · Deterministic builder.** `feedback::build_feedback` is a pure function of the document name, version id,
  source hash, source text and annotation views. No clock, no random value. The same input gives the same bytes.
- **D22 · What is included.** Only annotations with status `open`. Order is by source start offset, then id. An
  annotation whose `current` is `ambiguous` or `orphaned`, or which is `stale`, is still included. It gets a
  `WARNING` line saying why, and no source lines for ambiguous or orphaned (PRD §6.3, AT-07).
- **D23 · Verbatim.** The quote, the context and the user's comment each go in a fenced code block, and the fence is one
  backtick longer than the longest run of backticks inside it (minimum three). Nothing is escaped or trimmed.
  This departs from PRD §7.2's inline quotes on purpose, to guarantee verbatim text. Decision 0004 records it.
- **D24 · Shape.** `# Review Instructions`, `Document:`, `Source: version <ver_id>, sha256 <hash>`, a fixed
  `## Instructions` block (apply only the requested revisions, preserve everything else, report any ambiguous or
  conflicting target instead of guessing), then one `### rev_NNNN — COMMENT` section per annotation with
  `Section:` (heading path joined by ` > `), `Source lines:` (1-based, from the current text) and the fenced fields.
  The exact text is fixed by the snapshot files in `fixtures/export/`.
- **D25 · Clipboard and preview.** The panel shows the string returned by `generate_feedback()` and copies that same
  string with `navigator.clipboard.writeText` from a click. No clipboard plugin or permission is added. The preview and
  the copy cannot differ (AT-04).
- **D26 · Dependencies.** `tauri-plugin-dialog` and `time` (Rust). `sha2` moves from dev-dependencies to dependencies.
  No new web dependency, and several are removed (D9). Decision 0001 and 0003 list them.

## Non-goals

- Projects, the library, tabs, a sidebar explorer, the source editor and preview toggle, versions, review rounds
  beyond the fixed `rnd_0001`, reimport, reanchoring after edits (F3, F4).
- Replace, Remove, Expand, Question and Approve in the UI or in the export wording. Export package, manifest, multi-document
  export, token estimate, selection of which comments to export (F4).
- Drag and drop, recent files, find, themes, PDF (F3 to F5). Editing the Markdown file in any way.
- A rich export preview, a settings screen, signing or packaging.

## Lanes

| Lane | Touched | Checks |
|---|---|---|
| `web` | yes | `pnpm run check` |
| `rust` | yes | from `src-tauri/`: `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test` |
| `docs` | yes | no automated check. A reviewer reads against the acceptance criteria. |

## Packages

Waves:

| Wave | Packages | Release | Note |
|---|---|---|---|
| 1 | P1 | R1a (T-004) | |
| 2 | P2, P4 | R1b (T-004), R3 (T-006) | parallel, web and Rust |
| 3 | P3, P6 | R2 (T-005), R4 (T-007) | parallel, web and Rust |
| 4 | P5 | R3 (T-006) | after P3 and P4 |
| 5 | P7 | R4 (T-007) | after P5 and P6 |

Packages that share a wave share no files.

Shared acceptance for every package:

- The lane checks pass for its files, measured against the baseline.
- No test is deleted or skipped to pass a check, except the ones D9 names, which go with the code they test.
- New logic ships with tests in the same package that would fail if the behaviour broke (real inputs, edge and error
  paths). The full lane suite is green, not only the new tests.
- Source documents are never modified: every package that touches file access keeps a byte-identity check (AT-02).
- Every new dependency is listed in a decision record. A package that needs one that is not listed reports `blocked`.
- The branch passes the pre-PR audit (spec-plan step 10) before a PR is raised.

### P1 · Rust: promote the engine, open a file, resolve a selection (R1a · T-004, wave 1)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/Cargo.toml` (edit: `tauri-plugin-dialog`, `sha2` to dependencies)
  - `src-tauri/Cargo.lock` (edit)
  - `src-tauri/src/lib.rs` (edit: modules, state, plugin, command registration)
  - `src-tauri/src/markdown/mod.rs` (new, moved from `spike/mod.rs`)
  - `src-tauri/src/markdown/render.rs` (moved from `spike/render.rs`)
  - `src-tauri/src/markdown/resolve.rs` (moved from `spike/resolve.rs`)
  - `src-tauri/src/document.rs` (new)
  - `src-tauri/src/commands.rs` (new)
  - `src-tauri/tests/markdown_cases.rs` (moved from `spike_cases.rs`)
  - `src-tauri/tests/open_document.rs` (new)
  - `src-tauri/src/spike/mod.rs`, `src-tauri/src/spike/render.rs`, `src-tauri/src/spike/resolve.rs`, `src-tauri/tests/spike_cases.rs` (deleted)
- Acceptance criteria:
  1. `markdown_cases` still passes all 28 cases, prints its totals and checks fixtures byte-identical (D4).
  2. The hostile fixture renders with no script, event-handler attribute or `javascript:` link (D4).
  3. `document::open_path` returns the `OpenedDocument` fields of D2 and D3 for a fixture, and a test shows that two
     files with the same bytes have the same `version_id` and different `document_id`.
  4. A non-UTF-8 file and a file over 10 MiB give `not_utf8` and `too_large`, and the file bytes are unchanged (D1, AT-02).
  5. `resolve_selection` with no open document returns `no_document` (D5).
  6. `capabilities/default.json` still grants only `core:default` (D1). A test or `grep` in the package's check shows it.
  7. No `spike` module or debug-only command remains.

### P2 · Web: reader, typed API, delete engine A (R1b · T-004, wave 2)
- Lane: `web`
- ownedFiles:
  - `package.json` (edit: remove unified, remark, rehype packages and their types)
  - `pnpm-lock.yaml` (edit)
  - `src/main.tsx` (edit: import styles)
  - `src/styles.css` (new)
  - `src/App.tsx` (edit)
  - `src/App.test.tsx` (edit)
  - `src/api.ts` (new)
  - `src/reader/Reader.tsx` (new)
  - `src/reader/Reader.test.tsx` (new)
  - `src/review/capture.ts` (moved from `src/spike/capture.ts`)
  - `src/review/capture.test.ts` (new)
  - `src/spike/capture.ts`, `src/spike/markdown.ts`, `src/spike/resolve.ts`, `src/spike/SpikeView.tsx`, `src/spike/spike.test.ts`, `src/spike/bundle.test.ts` (deleted)
  - `Docs/MarkdownPrototype/Decisions/0001-reader-and-open-file-commands.md` (new)
- Acceptance criteria:
  1. `src/api.ts` has typed wrappers for `open_markdown` and `resolve_selection` and maps a `CommandError` to a typed
     error (D5, D6).
  2. `Reader.test.tsx` fakes the IPC boundary, opens a document and asserts the rendered text appears. A cancelled
     open shows nothing and no error.
  3. The reader renders only `html` from the opened document, and a test shows that a `<script>` string inside the
     document source text does not become an element.
  4. `capture.test.ts` covers a normal selection, a collapsed range, a selection across blocks (null), and a list item
     with a nested list.
  5. No `unified`, `remark-*`, `rehype-*`, `@types/mdast` or `@types/hast` remains in `package.json`, and
     `pnpm run check` passes without the deleted files.
  6. Decision 0001 records D1 to D9 with status Agreed.

### P3 · Web: floating menu, composer, panel and highlights (R2 · T-005, wave 3)
- Lane: `web`
- ownedFiles:
  - `src/review/FloatingMenu.tsx` (new)
  - `src/review/useSelection.ts` (new)
  - `src/review/highlight.ts` (new)
  - `src/review/CommentPanel.tsx` (new)
  - `src/review/useAnnotations.ts` (new)
  - `src/review/review.css` (new)
  - `src/review/review.test.tsx` (new)
  - `src/review/highlight.test.ts` (new)
  - `src/reader/Reader.tsx` (edit: mount the review layer)
  - `Docs/MarkdownPrototype/Decisions/0002-selection-comment-and-highlight.md` (new)
- Acceptance criteria:
  1. A selection inside one block shows the menu, and a collapsed selection or one across blocks does not (D10).
  2. `Cmd+Shift+M` opens the composer, `Cmd+Enter` saves, `Esc` closes and returns focus to the reader, and the
     selection is still there after the composer closes (D11).
  3. An `ambiguous`, `orphaned` or cross-block selection creates no comment and shows the matching message. The IPC
     fake returns each result in turn (D12).
  4. `highlight.ts` returns a range only when prefix + exact + suffix occurs exactly once in the DOM, with tests for 0,
     1 and 2 matches (D13).
  5. Clicking a comment in the panel scrolls to and focuses its passage.
  6. Comment text shown in the panel is exactly the text typed, including leading and trailing spaces and backticks.
  7. Decision 0002 records D10 to D14 with status Agreed.

### P4 · Rust: annotation store with atomic writes (R3 · T-006, wave 2)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/Cargo.toml` (edit: `time`)
  - `src-tauri/Cargo.lock` (edit)
  - `src-tauri/src/lib.rs` (edit: store state, command registration)
  - `src-tauri/src/commands.rs` (edit: annotation commands)
  - `src-tauri/src/domain/mod.rs` (edit: `schema_files`)
  - `src-tauri/src/domain/store.rs` (new: `AnnotationFile`, `AnnotationView`)
  - `src-tauri/src/store/mod.rs` (new)
  - `src-tauri/src/store/atomic.rs` (new)
  - `src-tauri/src/store/annotations.rs` (new)
  - `schemas/v1/domain.schema.json` (edit, generated)
  - `src-tauri/tests/annotation_store.rs` (new)
- Acceptance criteria:
  1. `AnnotationFile` round-trips through serde, and `schema_drift` fails if the committed schema differs (D15).
  2. Create, list, update and delete work against a temp directory. Ids are `rev_0001`, `rev_0002`, and after deleting
     `rev_0002` the next id is `rev_0003` (D17).
  3. After a store is dropped and re-opened on the same directory, every annotation is back unchanged, including text
     with leading spaces, backticks and non-BMP characters (D19, AT-01).
  4. `write_atomic` replaces a file, leaves no temp file behind, and returns an error without touching the existing
     file when the target folder is unwritable (D16).
  5. A corrupt annotation file, and one with `schema_version` `2.0.0`, make every command return an error and leave the
     file's bytes unchanged (D16).
  6. `create_annotation` refuses an `ambiguous` or `orphaned` selection and empty or whitespace-only text, and builds
     the anchor from the open document (D19).
  7. `list_annotations` reports `stale: true` when the stored `source_hash` differs from the open file, and does not
     change the stored file (D20).
  8. Timestamps parse as RFC 3339 UTC (D18).

### P5 · Web: wire the panel to the store, show anchor state (R3 · T-006, wave 4)
- Lane: `web`
- ownedFiles:
  - `src/api.ts` (edit)
  - `src/review/useAnnotations.ts` (edit: Rust-backed)
  - `src/review/CommentPanel.tsx` (edit: state badges, edit, delete)
  - `src/domain/validate.ts` (edit: `AnnotationFile`)
  - `src/domain/validate.test.ts` (edit)
  - `src/domain/generated/domain.schema.d.ts` (edit, generated)
  - `fixtures/domain/valid.json` (edit)
  - `fixtures/domain/invalid.json` (edit)
  - `src/review/persistence.test.tsx` (new)
  - `Docs/MarkdownPrototype/Decisions/0003-annotation-storage-ids-and-atomic-writes.md` (new)
- Acceptance criteria:
  1. After opening a document, `list_annotations` results appear in the panel, with a badge for `ambiguous`, `orphaned`
     and `stale` (D20).
  2. Creating, editing and deleting a comment call the Rust commands, and the panel shows what Rust returns, not a
     local copy.
  3. `AnnotationFile` has valid and invalid fixture cases and passes the coverage test in `validate.test.ts`, and
     `pnpm run gen:types` leaves no diff (D15).
  4. A failed command shows the error and keeps the panel as it was.
  5. Decision 0003 records D15 to D20 and the added dependencies (D26) with status Agreed.

### P6 · Rust: deterministic feedback builder with snapshot files (R4 · T-007, wave 3)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/src/lib.rs` (edit: module, command)
  - `src-tauri/src/commands.rs` (edit: `generate_feedback`)
  - `src-tauri/src/feedback.rs` (new)
  - `src-tauri/tests/feedback_cases.rs` (new)
  - `fixtures/export/inputs.json` (new)
  - `fixtures/export/single-resolved.expected.md` (new)
  - `fixtures/export/ordering-and-excluded.expected.md` (new)
  - `fixtures/export/ambiguous-orphaned-stale.expected.md` (new)
  - `fixtures/export/backticks-and-unicode.expected.md` (new)
  - `fixtures/export/no-annotations.expected.md` (new)
- Acceptance criteria:
  1. `feedback_cases` builds each case from `inputs.json` and compares byte for byte with its `.expected.md` (D24).
  2. The same input built twice gives identical bytes, and shuffling the input annotations gives identical bytes (D21, D22).
  3. Only `open` annotations appear, ordered by source start then id (D22).
  4. Ambiguous, orphaned and stale annotations carry a `WARNING` line, and ambiguous and orphaned ones have no source
     lines (D22, AT-07).
  5. A comment containing a run of backticks and non-BMP text appears byte for byte inside its fence (D23).
  6. With no annotations the output says so and still has the instruction block.

### P7 · Web: export panel and copy (R4 · T-007, wave 5)
- Lane: `web`
- ownedFiles:
  - `src/review/ExportPanel.tsx` (new)
  - `src/review/export.test.tsx` (new)
  - `src/api.ts` (edit)
  - `src/App.tsx` (edit: mount the panel)
  - `Docs/MarkdownPrototype/Decisions/0004-feedback-prompt-format.md` (new)
  - `Docs/OVERVIEW.md` (edit: F2 spec link and status)
- Acceptance criteria:
  1. The panel shows the string from `generate_feedback`, and the Copy button writes exactly that string to the
     clipboard. The test fails if the two differ (D25, AT-04).
  2. With no document open, or a command error, the panel shows the error and Copy is disabled.
  3. Decision 0004 records D21 to D25 and the departure from PRD §7.2 (D23), status Agreed.
  4. `Docs/OVERVIEW.md` links the F2 spec and shows its status.

## Follow-ups

- Real LLM handoff is a manual step (PRD §5.1 gate). The manual testing document covers it.
- Entity and escape text still maps coarsely in the resolver. A comment on such text may highlight a wider range.
  Add fixtures with real LLM output early in this feature if they show up.

## Resolved questions

- **Storage → D15.** App-data JSON sidecar per document, replaced or migrated by F3.
- **Interaction → D10.** Comment only in the UI, all six values in the model.
- **File access → D1.** A Rust command shows the dialog. The web side gets no `dialog` or `fs` permission.

## Open questions

- **Q1 · Highlight API support.** D13 uses the CSS Custom Highlight API, which needs a recent WKWebView (macOS 14 or
  later, by my reading, not checked). Default: assume it works and fall back to no highlight. Blocks R2's highlight only.
