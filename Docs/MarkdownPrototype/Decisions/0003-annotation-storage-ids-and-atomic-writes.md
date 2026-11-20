# 0003 · Comments live in one atomically written JSON file per document, and Rust owns every change

**Status:** Agreed · **Work items:** T-006 · **Spec:** `Docs/MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md` D15–D20, D26

- **Where.** `<app data dir>/annotations/<document_id>.json`, holding `AnnotationFile { schema_version, document_id, path,
  next_sequence, annotations }`. It is a Rust type with a generated schema and TypeScript type like every persisted
  shape, at `schema_version` `1.0.0`. F3 decides the project storage format and may replace this file.
- **Writes.** A save writes a temp file in the same folder, syncs it, then renames it over the target, so a crash leaves
  the old file or the new one. A file that cannot be parsed, has no `schema_version`, has a newer major version, or
  belongs to a different `document_id` makes every command fail and is never overwritten. One writer at a time.
- **Ids.** A comment id is `rev_` + a four-digit number from `next_sequence`, which only grows. A deleted id is never
  reused. The round is always `rnd_0001`. A comment records the `source_hash` of the file it was made against.
- **Timestamps.** RFC 3339 UTC, set by Rust (`time` crate). This closes the F1 `shortcut:` for annotations.
- **Commands.** `create_annotation`, `list_annotations`, `update_annotation`, `delete_annotation`. Create resolves the
  selection itself against the open file and builds the anchor in Rust. It refuses anything but `resolved`, and empty or
  whitespace-only text. The UI never sends a range. Text is stored exactly as typed.
- **Changed files.** `list_annotations` returns each comment with `current` (a fresh resolution of its quote against
  the open text) and `stale` (its `source_hash` differs from the open file's). Nothing stored changes, and nothing is
  re-anchored (PRD §6.2). The panel shows a badge for each state and the highlight is painted only for `resolved`.
- **One source of truth.** The web side keeps no copy. After every command it re-reads the list, and a failed command
  shows its message and leaves the list as it was. Opening a document clears the previous document's comments first.

## Why

Losing or misplacing a comment is a release blocker (PRD §11.3). Atomic writes and refusing to touch a file it cannot
read mean a bad day on disk costs at most the change being made, never the existing comments. Computing anchors in Rust
means the UI cannot save a range that the engine would not accept.

## Consequences

- New dependencies: `time` (Rust, with `formatting` and `parsing`). `sha2` and `tauri-plugin-dialog` came in with R1a.
- A renamed or moved file is a new document, so its comments do not follow it until F3.
- A file that cannot be read stays unusable until someone fixes or removes it. There is no repair or backup step yet.
  The first migration must add one (decision FoundationSpike 0003).
- Delete has no confirmation or undo.
- The write lock is inside one process. Two app instances on the same file can overwrite each other's last change.
  Blocking a second instance needs `tauri-plugin-single-instance`, a new dependency that needs its own decision.
