# Manual testing: Projects and persistence (F3)

**Spec:** `Docs/ProjectsAndPersistence/Specs/2026-11-20-F3-projects-and-persistence.md`
**Branch / PR:** none, work is on `main`
**Work items:** F3 · tasks T-008 (R1a, R1b), T-009 (R2), T-010 (R3), T-016 (R4)
**Environment:** a macOS development machine running `pnpm tauri dev`, then a debug build. No test server.
**Covers:** all releases, end to end. Automated checks (including `pnpm run test:e2e`) are not repeated here. This
covers what only a real macOS WKWebView, the native dialogs and a real file system show.

## What changed

### R1a · Projects and library, Rust (task T-008)

- **Projects.** A project is a normal folder with a hidden `.review-workspace/`. A library remembers recent projects.
- **Adding documents.** Files are copied into the project and never overwrite.

### R1b · Home screen (task T-008)

- **Home.** Recent projects, New project, Open folder and Quick open.

### R2 · Workspace (task T-009)

- **Explorer, tabs and sidebars.** Several documents open in tabs, with comments and export in a right sidebar.

### R3 · Source editor and safe save (task T-010)

- **Editor.** A source view with highlighting, find and shortcuts. Saving never overwrites a file changed on disk.

### R4 · External changes, backups and recovery (task T-016)

- **Safety net.** Outside changes are noticed, old bytes are backed up, and unsaved edits come back after a crash.

## Setup

- `pnpm install --frozen-lockfile` once. Run `pnpm tauri dev`.
- Make a **scratch folder** with two or three real Markdown files (copies, never your only copies). Include one with CRLF
  line endings (`fixtures/markdown/crlf.md`) and note `shasum -a 256` of every file before starting.
- Keep `fixtures/markdown/hostile.md` handy. Have a second editor (for example TextEdit or VS Code) ready for the
  external-change cases.
- Quit the app from the Dock or Cmd+Q for restart cases. Use Activity Monitor to Force Quit for the crash case.

## Change checklist

| ✓ | Release | Work item | Change | Spec ref | Test case |
|---|---|---|---|---|---|
| ☐ | R1a | T-008 | New project and Open folder, nothing else in the folder is touched | D1, D5 | 1, 2 |
| ☐ | R1a | T-008 | Add document copies, refuses duplicates, never overwrites | D7 | 3 |
| ☐ | R1a | T-008 | Library lists recents, shows missing folders, rename and remove | D4, D8 | 4, 5 |
| ☐ | R1b | T-008 | Home screen actions and cancelled dialogs | D11, D12 | 1, 2, 4 |
| ☐ | R2 | T-009 | Explorer, tabs, sidebars | D13, D14 | 6, 7 |
| ☐ | R2 | T-009 | Comments belong to their document, inside the project | D6, D14 | 8 |
| ☐ | R2 | T-009 | Quick Open still works | D15, D6 | 9 |
| ☐ | R3 | T-010 | Toggle never changes the file | D19 | 10 |
| ☐ | R3 | T-010 | Edit, save, line endings preserved, editor shortcuts | D17, D20, D21, D23 | 11, 12 |
| ☐ | R3 | T-010 | Comments after an edit are stale, Comment is disabled while dirty | D22 | 13 |
| ☐ | R3 | T-010 | Editor works under the CSP | D18 | 11 |
| ☐ | R4 | T-016 | External change: banner, conflict choices | D24, D25 | 14, 15 |
| ☐ | R4 | T-016 | Backups before every overwrite | D26 | 16 |
| ☐ | R4 | T-016 | Crash recovery of unsaved edits | D27, D28 | 17 |
| ☐ | all | T-008..T-016 | No user file changes except by an explicit save, works offline | D7, D21 | 18 |

## Test cases

### R1a · Projects and library (task T-008)

### 1. New project
On the home screen click New project and pick a new folder that already holds one unrelated file. Cancel once first.
- Cancel changes nothing. The project opens, shows no documents, and the unrelated file is not listed and unchanged.
- The folder now holds a hidden `.review-workspace/project.json` and nothing else new.

### 2. Open folder
Quit, relaunch and use Open folder on the same folder. Then try Open folder on a folder that is not a project.
- The project opens with the same name. The other folder is refused with "not a project" and gets no new files.

### 3. Add document
Add a Markdown file from elsewhere. Add the same file again. Add a different file with the same name. Add an image
renamed `.md`.
- The first is copied into the project root and appears in the list. The original is unchanged.
- The second and third are refused with a message to rename the source file, and the existing copy's bytes are unchanged.
- The image is refused, and nothing is copied.

### 4. Library
Open two projects, then go home. Move one project folder to another place in Finder and reopen the app.
- Recent projects are newest first. The moved one shows `Folder missing`, and is not removed.
- Open folder on the moved location finds the same project, and the card now points there with its comments intact.

### 5. Rename and remove
Rename a project, then Remove another.
- The rename shows on the card and in the project, and the folder name in Finder is unchanged.
- Remove warns that the folder stays on disk, and afterwards the folder and its files are all still there.

### R2 · Workspace (task T-009)

### 6. Explorer and tabs
Open a project with three documents. Open all three, switch with the mouse and with the arrow keys, close the middle tab,
then close the rest.
- Each document opens in its own tab. Arrow keys move between tabs. Closing activates a neighbour. The last close shows
  an empty state. Hidden files never appear in the explorer.

### 7. Sidebars
Collapse and expand both sidebars by button and by shortcut.
- The document keeps its scroll position and nothing is lost. Note any shortcut that macOS or WKWebView swallows.

### 8. Comments belong to their document
Add a comment in document A and another in B. Switch tabs. Look inside `.review-workspace/annotations/`.
- Each tab shows only its own comments. The comment files are inside the project, one per document.

### 9. Quick Open
From home use Quick open on a file outside any project.
- It opens with no explorer and a "not in a project" label. Its comments survive a relaunch, as in F2.

### R3 · Source editor and safe save (task T-010)

### 10. Toggle
Open a document, toggle between rendered and source many times without typing. Compare `shasum -a 256`.
- The hash is unchanged and the file's modified time did not change.

### 11. Edit and save
In source, type, use Cmd+B, Cmd+I, Cmd+F and undo and redo. Press Cmd+S.
- The tab shows a dirty marker until saved. The highlighting looks right and there are no styling glitches or CSP
  errors in the console. After saving, the rendered view shows the new text and the file on disk matches.

### 12. Line endings
Open `crlf.md`, change one word, save, and inspect the bytes (`xxd` or `file`). Open a file with mixed line endings.
- Only the changed word differs and every other line ending is still CRLF. The mixed file opens read-only with a message.

### 13. Comments after an edit
Add a comment, edit the commented sentence in source and save, then view rendered. Make an unsaved edit and try to comment.
- The old comment shows as out of date or not found, and nothing was re-anchored. Comment is disabled while the tab is
  dirty, with a message.

### R4 · External changes, backups and recovery (task T-016)

### 14. External change, clean tab
Open a document, edit and save the same file in another editor, then click back into the app.
- A banner says the file changed and offers Reload. Nothing reloads by itself. Reload shows the new text.

### 15. External change, dirty tab
Type an unsaved edit, change the file in another editor, then press Cmd+S.
- A conflict dialog appears with Keep editing as the default. Keep editing writes nothing. Load the disk version keeps
  your text as a backup. Overwrite asks a second time, and the other editor's version is kept as a backup. Check each outcome on disk.

### 16. Backups
Save the same document several times with changes. Look in `.review-workspace/backups/`.
- A backup of the previous bytes exists for every save, each byte-identical to the file before that save. A save with no change adds none.

### 17. Crash recovery
Type unsaved edits, wait three seconds, then Force Quit. Relaunch and open the document.
- You are offered Restore or Discard. Restore brings the text back as unsaved. Repeat, but edit the file in another editor
  before restoring: saving the restored text goes to the conflict dialog.

### All releases

### 18. No stray changes, offline
With Wi-Fi off repeat cases 3, 11, 15 and 17. Run `shasum -a 256` on every file in the scratch folder.
- Everything works offline. Only files you explicitly saved or overwrote differ from the setup hashes, and every
  overwritten version has a backup.

## Watch for

- The editor looking unstyled, or a CSP error in the console (D18).
- Shortcut clashes: Cmd+B, Cmd+I, Cmd+F, Cmd+S, Cmd+\ and Cmd+Shift+M.
- A file's modified time changing when nothing was saved.
- A comment that shows in the wrong tab or after switching documents quickly.
- A banner or dialog that appears while typing (it should not), or a conflict that reappears after Keep editing.
- A draft that is restored when it should not be, or one left behind after a successful save.
- Temp files such as `.name.md.tmp-1234` left in the project root after a crash.

## Known and accepted

- **No drag and drop,** no subfolders, no renaming or deleting documents, no deleting a project's contents.
- **No versions or reimport.** Comments on edited text are shown as out of date and are not re-anchored. F4 does that.
- **Quick Open comments** stay in app data and are not moved into a project.
- **No file watcher.** Changes are noticed when the window regains focus and on save.
- **Two app instances** can overwrite each other's last comment change.

## Quick pass / fail summary

| # | Release | Area | Pass / Fail | Notes |
|---|---|---|---|---|
| 1 | R1a | New project | | |
| 2 | R1a | Open folder | | |
| 3 | R1a | Add document | | |
| 4 | R1a | Library | | |
| 5 | R1a | Rename and remove | | |
| 6 | R2 | Explorer and tabs | | |
| 7 | R2 | Sidebars | | |
| 8 | R2 | Comments per document | | |
| 9 | R2 | Quick Open | | |
| 10 | R3 | Toggle | | |
| 11 | R3 | Edit and save | | |
| 12 | R3 | Line endings | | |
| 13 | R3 | Comments after an edit | | |
| 14 | R4 | External change, clean | | |
| 15 | R4 | External change, dirty | | |
| 16 | R4 | Backups | | |
| 17 | R4 | Crash recovery | | |
| 18 | all | No stray changes, offline | | |
