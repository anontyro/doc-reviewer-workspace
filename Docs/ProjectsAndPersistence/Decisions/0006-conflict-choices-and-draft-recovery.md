# 0006 · A conflict never overwrites without a second confirmation, and unsaved edits are recovered from an atomic draft

**Status:** Agreed · **Release:** R4 · **Written by:** P8 · **Spec:** D24, D25, D27

## Rule

- When the file under an unsaved edit has changed on disk, the user chooses. Keep editing is the default and writes nothing.
  Overwriting the disk version needs two clicks and is never the default.
- Unsaved text is written to a draft two seconds after the last keystroke, and the user is offered it back after a crash.
- A restored draft is checked against the file like any other edit, so a file that changed since the draft was made still
  goes through the conflict dialog.

## Why

- Losing a collaborator's or another tool's edit is the worst outcome (AT-06), so the only path that replaces a changed file
  is a deliberate second confirmation, and the disk version is backed up first (decision 0005).
- A draft written on a short delay loses at most a few seconds of typing to a crash, without writing on every keystroke.
- A draft remembers the hash it was made from (`base_hash`), so restoring can tell whether the file moved on.

## What the code does

- The window's `focus` event calls `check_document`. A save also checks first. There is no file watcher.
- A clean tab whose file changed shows a banner with Reload. Nothing reloads until it is clicked. A missing file shows where
  it was, turns Save off and keeps the text.
- A dirty tab whose file changed, or a save refused with `conflict`, opens the dialog. Keep editing closes it, and the same disk
  version does not ask again on later focus events. Trying to save always shows it again.
- **Load the disk version** first sends the user's text to `backup_text`, which keeps it in the backups folder, then clears the
  draft and re-reads the file. If the backup fails, the text stays and nothing reloads.
- **Overwrite** shows a second step ("Keep editing" is focused). Only its confirm button saves, using the disk hash it was shown
  as `expected_hash`, so a file that changes again in between is a new conflict, not an overwrite.
- A successful save, Discard on a closed tab or on leaving the project, Load the disk version and the recovery prompt's Discard
  all clear the draft. Rust has one active document, so a draft of another tab is cleared by making that tab active first.
- Opening a document reads its draft. A draft equal to the file is cleared silently. Otherwise Restore loads it as unsaved
  text with `expected_hash = base_hash` in the source view, and Discard deletes it. A tab that already has unsaved text in
  memory keeps that and is not offered the older draft. A draft that cannot be read is reported and left in place.

## Differences from the spec

- "The user's text is saved as a backup" needed a way to write arbitrary text to the backups folder, so a small
  `backup_text` command was added in Rust (not in P8's file list).
- A Quick Open file cannot be re-read by the app (there is no command for it), so its dialog has no "Load the disk version"
  and its banner has no Reload. Overwrite and Keep editing work.
- If the user switches tabs within two seconds of typing, that tab's draft is not written until they return to it. The text
  itself is kept in memory.
