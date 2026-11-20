# 0005 · Changes are detected by hash on focus and save, and the old bytes are backed up before every overwrite

**Status:** Agreed · **Release:** R4 · **Written by:** P7 · **Spec:** D24, D26, D27, D28

## Rule

- Rust compares the active file's bytes on disk with the hash it read (`check_document`) and with the hash the editor
  loaded from (`save_document`). A mismatch is `changed` or a `conflict`. Nothing is overwritten silently.
- Before `save_document` replaces a file, Rust copies the old bytes into a backup folder. If it cannot, the save fails and
  nothing changes.
- Unsaved editor text is kept in an atomic draft file. A draft that cannot be read is never overwritten or deleted.

## Why

- A hash of the bytes cannot be fooled by a rewrite with the same content, and needs no file watcher, which keeps the
  permission surface small. The cost is that a change is noticed on window focus or on save, not the moment it happens.
- A backup taken before the write means every overwrite can be undone by hand, including an Overwrite the user chose after a
  conflict (the disk version is what gets backed up).
- Keeping an unreadable draft where it is means a bug or a newer app version can never destroy the user's only copy.

## What the code does

- `check_document` returns `{status: "unchanged"}`, `{status: "changed", disk_hash}` or `{status: "missing"}`. It writes nothing.
- Backups live in `<root>/.review-workspace/backups/<document_id>/` for a project document and in
  `<app data>/backups/<document_id>/` for a Quick Open file. A backup is `<yyyymmddThhmmssZ>-<hash8>.md`, a byte copy of
  the old file. If the newest backup already has the same hash, none is added.
- The order inside a save is: size check, hash check (a `conflict` stops here, so it leaves no backup), backup, atomic write,
  restore permissions, prune. Pruning keeps the newest 20 and runs only after the write succeeded. A prune failure is ignored.
- Drafts live in `<root>/.review-workspace/drafts/<document_id>.json` (Quick Open: `<app data>/drafts/`), written atomically as
  a `DraftFile`. `save_draft` and `clear_draft` read the existing file first and stop if it is unusable. `read_draft`
  reports that error too. Draft text over 10 MiB is refused.
- When a project is opened, `.<name>.tmp-*` files anywhere under `.review-workspace/` are deleted. Temp files in the project
  root are left alone because that folder is the user's.

## Differences from the spec

- `AppState::save` takes the backup location and the time as arguments, so the backup path is decided by Tauri state and
  tests can set the time. The P5 save tests changed to pass them.
- Two different backups made within one second sort by hash, so "newest" between them is arbitrary. It only affects skipping a
  duplicate and which backup is pruned first.
