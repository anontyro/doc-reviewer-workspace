# 0004 · CodeMirror 6 is the editor, line endings are preserved byte for byte, and the CSP allows inline styles only

**Status:** Agreed · **Release:** R3 · **Written by:** P6 · **Spec:** D17 to D23

## Rule

- The source editor is CodeMirror 6, bundled locally, with no network use.
- The text sent to `save_document` is exactly the file's text: its own line separator, and its trailing newline or lack of one.
  A file with mixed endings or a lone `\r` opens read-only.
- Toggling between rendered and source never writes. Unsaved text lives in the web, per tab, until it is saved or discarded.
- The CSP is `default-src 'self'; style-src 'self' 'unsafe-inline'`.

## Why

- CodeMirror gives Markdown highlighting, undo, find and a tested editing model, so none of that is written here.
- Preserving bytes is the point of F1 decision 0005 (CRLF is never normalised). If the editor guessed one separator for a
  mixed file, saving would change lines the user never touched, so those files are read-only instead.
- **CSP.** CodeMirror adds `<style>` elements while running, and `style-src 'self'` blocks them. A nonce would need the page to
  know the value Tauri generates, and nothing hands it to the page, so spec option 1 (`EditorView.cspNonce`) has no source for
  its value. The nonce route was not tried in the real app. Option 2 was taken: allow inline styles. Inline styles cannot run
  script, and `script-src` falls back to `default-src 'self'`, so scripts, images, fonts and connections are as blocked as
  before. A test pins the exact policy, so widening it further fails a test.

## What the code does

- Packages: `@codemirror/state`, `view`, `commands`, `lang-markdown`, `language`, `search`.
- `detectEndings` counts `\r\n`, lone `\n` and lone `\r`. All `\n` or all `\r\n` is edited with
  `EditorState.lineSeparator` set to that separator, and the text is read back with `state.sliceDoc()`, which joins lines with
  the same separator. Anything else sets `readOnly` and `editable` off and shows the reason.
- `Cmd+S` is bound inside the editor. `Cmd+B` and `Cmd+I` wrap the selection in `**` and `*`, or insert a pair with the cursor
  between. `Cmd+F` is CodeMirror's find. Undo and redo are CodeMirror's history.
- A tab is dirty when its text differs from the saved text. The edit keeps the `source_hash` it started from, and save sends
  that as `expected_hash`, so a file changed meanwhile comes back as `conflict`. On any save error the text and the marker stay.
- In the rendered view of a dirty tab a banner says the text shown is the last saved one, and Comment is disabled with
  "Save first: comments attach to the saved text".
- Closing a dirty tab, or leaving the project while any tab is dirty, asks first. Keep editing is the default.

## Differences from the spec

- Leaving the project with unsaved text also asks, because dropping the web state would lose it. The spec only asked for
  closing a tab.
- Undo history is per editor instance, so it starts fresh when a tab is re-activated or the view is toggled. The unsaved text
  itself is kept.
- The CSP is verified here only by the pinned test. Whether the editor is styled correctly in the real window is checked by
  manual case 11.
