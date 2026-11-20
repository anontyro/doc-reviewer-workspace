# ProjectsAndPersistence decisions

The rules the projects and persistence feature is built on, one per file. Each file says what the code does and why. For
how it does it, read the code.

**Spec:** `Docs/ProjectsAndPersistence/Specs/2026-11-20-F3-projects-and-persistence.md` · **Manual testing:** `../Testing/MANUAL-TESTING-F3-projects-and-persistence.md` · **Work item:** F3

## How to use this folder

- **Change a decision in the same change as the code.** The review then checks the diff against the rule written here.
- **Edit the file in place when a decision changes.** Git keeps the history, so don't add dated amendments or
  "previously" notes.
- **Add a new decision under the next number** and list it below. Numbers are never reused. A dropped decision's file
  is deleted.
- **Cite decisions by number**, for example "ProjectsAndPersistence decision 0003", in commits, work items and reviews.

| Status | Means |
|---|---|
| Agreed | The contract is settled, but the code isn't in main yet |
| Accepted | Built and in main |

## R1a · Projects and library (T-008)

| # | Decision | Written by |
|---|---|---|
| [0001](0001-project-folder-library-and-identity.md) | A project is a folder with a portable `project.json`, recent projects live in an app-data `library.json`, and a document's id survives moving the folder. | P2 |
| [0002](0002-safe-adding-removal-and-paths.md) | Adding copies and never overwrites, removal forgets the library entry only, and document paths are single file names that cannot leave the project. | P2 |

## R2 · Workspace (T-009)

| # | Decision | Written by |
|---|---|---|
| [0003](0003-workspace-tabs-and-active-document.md) | Rust holds one active document and re-reads it from disk on every activation, while tabs live in the web. | P4 |

## R3 · Source editor and safe save (T-010)

| # | Decision | Written by |
|---|---|---|
| [0004](0004-source-editor-line-endings-and-csp.md) | CodeMirror 6 is the editor, line endings are preserved byte for byte, and the CSP stays as tight as the editor allows. | P6 |

## R4 · External changes, backups and recovery (T-016)

| # | Decision | Written by |
|---|---|---|
| [0005](0005-change-check-and-backups.md) | Changes are detected by hash on focus and save, and the old bytes are backed up before every overwrite. | P7 |
| [0006](0006-conflict-choices-and-draft-recovery.md) | A conflict never overwrites without a second confirmation, and unsaved edits are recovered from an atomic draft. | P8 |
