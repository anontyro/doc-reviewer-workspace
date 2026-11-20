# 0001 · Rust opens files through a native dialog, and the web side reaches Rust only through `src/api.ts`

**Status:** Agreed · **Work items:** T-004 · **Spec:** `Docs/MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md` D1–D9

The web side has no file permission. The Rust command `open_markdown` shows the native open dialog, reads the chosen
file and returns it rendered. Rust keeps that one document as the open document, and later commands work against it.

- **Permissions.** `capabilities/default.json` grants only `core:default`. A Rust test fails if it grows. The dialog
  plugin is used from Rust only, so the web side cannot open or read any file by itself.
- **Limits.** A file that is not UTF-8, or is over 10 MiB, is refused with a typed error. Cancelling returns nothing and
  changes nothing. Opening never writes to the file.
- **Ids.** `document_id` is `doc_` + 16 hex of sha256 of the canonical path. `version_id` is `ver_` + 16 hex of sha256 of
  the bytes. `source_hash` is the full sha256. A moved or renamed file is a new document until F3.
- **Commands.** `open_markdown` and `resolve_selection`. Every command fails with `{ kind, message }`, where `kind` is one
  of `no_document`, `not_utf8`, `too_large`, `io`, `invalid`.
- **Rendering.** The Rust engine from FoundationSpike decisions 0004 and 0005 is the `markdown` module, unchanged.
  comrak's safe mode is still the only sanitiser. The reader injects `html` and never the source text.
- **One door.** The web side calls Rust only through typed wrappers in `src/api.ts`. Tests may fake the IPC boundary
  and nothing else. The Rust shapes are copied by hand into `api.ts` for now.
- **CSP.** `style-src 'self'` stays. Run-time positioning uses CSSOM, never a `style` attribute in markup.
- **Deleted.** Engine A (`unified`, `remark-*`, `rehype-*`), the spike view and their tests are gone, along with the
  behaviour they covered. The Rust tests cover that behaviour. `capture.ts` lives in `src/review/`.

## Why

A narrow Rust door keeps the web layer unable to touch the user's files (PRD §7.5, Non-negotiables), and one shape of
error means every screen handles failures the same way. A path hash and a content hash give ids with no stored state.

## Consequences

- New dependencies: `tauri-plugin-dialog` (which pulls in `tauri-plugin-fs` on the Rust side only, with no permission
  granted to the web side). `sha2` is now a normal dependency. Web: `unified`, `remark-*`, `rehype-*` and their types are removed.
- Hand-copied TypeScript shapes can drift from Rust. Generate them if the command set keeps growing.
- A 10 MiB cap is a guess. Revisit it with real documents (T-020).
