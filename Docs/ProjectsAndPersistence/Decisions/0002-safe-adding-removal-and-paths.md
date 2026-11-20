# 0002 · Adding copies and never overwrites, removal forgets the library entry only, and paths cannot leave the project

**Status:** Agreed · **Work items:** T-008 · **Spec:** `Docs/ProjectsAndPersistence/Specs/2026-11-20-F3-projects-and-persistence.md` D5, D7 to D9

- **Adding.** `add_document` accepts one UTF-8 `.md` file of at most 10 MiB, chosen in a native dialog. The copy goes to a
  temp file in the project root and is then hard-linked into place (`store::atomic::write_new`). The link fails if the name
  exists, so an existing file is never replaced, even when two adds race, and a half-written file never appears under the
  final name. A name already in the project is refused with `exists` and a message to rename the source file. Nothing is
  renamed automatically. The source file is only read.
- **Already in the folder.** A file chosen from inside the project root is tracked without a copy. Adding it again is `exists`.
- **If tracking fails** after a copy, the copy is removed, because nothing else points at it yet.
- **Removal.** Removing a project deletes only its library entry. The folder, its documents and `.review-workspace/` stay on
  disk. F3 has no action that deletes project contents. Forgetting an unknown id is harmless.
- **Rename.** Changes `name` in `project.json` and the library. The folder name is not touched. Names are 1 to 100
  characters after trimming, with no control characters.
- **Paths.** A document's `relative_path` is a single `.md` file name: no separator, no `..`, no leading dot, no control
  character. Before a document is read, its canonical path must have the canonical project root as its parent, so a symlink
  that leads outside is refused with `invalid`. A document that has gone is `missing`.

## Why

PRD §8.4 forbids silently removing or overwriting user files. A link that cannot replace is the one write that is safe
against a race, and keeping removal to the library means the first version of the feature cannot destroy work.
