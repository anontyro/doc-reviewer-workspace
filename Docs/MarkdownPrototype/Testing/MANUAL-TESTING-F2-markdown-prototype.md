# Manual testing: Markdown review prototype (F2)

**Spec:** `Docs/MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md`
**Branch / PR:** `feature/F2-markdown-prototype`
**Work items:** F2 · tasks T-004 (R1a, R1b), T-005 (R2), T-006 (R3), T-007 (R4)
**Environment:** a macOS development machine running `pnpm tauri dev`, then a debug build. No test server.
**Covers:** all releases, end to end. Automated checks are not repeated here. This covers what only a real macOS
WKWebView, the native file dialog and a real LLM chat show.

## What changed

### R1a · Open and render, Rust (task T-004)

- **Open a file.** A native dialog opens a Markdown file, and Rust renders it.

### R1b · Reader view (task T-004)

- **Reader.** The rendered file is shown. The old spike view is gone.

### R2 · Select and comment (task T-005)

- **Floating menu and comments.** Selecting text shows a menu. Comments show in a side panel with highlights.

### R3 · Persist comments (task T-006)

- **Saved comments.** Comments are still there after quitting and reopening, and say if they no longer match.

### R4 · Copy feedback (task T-007)

- **Export panel.** The panel shows the prompt and copies it.

## Setup

- `pnpm install --frozen-lockfile` once. Run `pnpm tauri dev`.
- Make a working copy of a real LLM-written Markdown file (a few headings, lists, a table, a code block). Never use the
  only copy. Note `shasum -a 256` of it before starting.
- Also have `fixtures/markdown/repeated-text.md` and `fixtures/markdown/hostile.md` ready (copy them out of the repo).
- Turn Wi-Fi off for case 12. Have an LLM chat open for case 11.

## Change checklist

| ✓ | Release | Work item | Change | Spec ref | Test case |
|---|---|---|---|---|---|
| ☐ | R1a | T-004 | Native dialog opens a file, cancel does nothing | D1 | 1 |
| ☐ | R1a | T-004 | Bad files are refused and untouched | D1, D2 | 2 |
| ☐ | R1b | T-004 | Rendered reader, hostile file inert | D4, D7 | 3, 4 |
| ☐ | R2 | T-005 | Menu appears, never covers the selection | D10 | 5 |
| ☐ | R2 | T-005 | Keyboard flow works, selection survives | D11 | 6 |
| ☐ | R2 | T-005 | Ambiguous and cross-block selections are refused | D12 | 7 |
| ☐ | R2 | T-005 | Highlight and click-to-jump | D13 | 8 |
| ☐ | R3 | T-006 | Comments survive quit and relaunch | D15, D17, D19 | 9 |
| ☐ | R3 | T-006 | Edited source shows stale or orphaned, nothing repaired | D20 | 10 |
| ☐ | R4 | T-007 | Prompt matches the preview and works in an LLM chat | D21 to D25 | 11 |
| ☐ | all | T-004..T-007 | Source file bytes unchanged, full flow offline | D2 | 12 |

## Test cases

### R1a · Open and render (task T-004)

### 1. Open and cancel
Click Open, pick the working copy. Then click Open again and cancel the dialog.
- The file shows rendered. Cancelling leaves what was open as it was, with no error.

### 2. Bad files
Try opening a binary file (an image renamed `.md`) and a very large file (over 10 MiB).
- Each is refused with a clear message. Nothing else changes, and neither file is modified.

### R1b · Reader view (task T-004)

### 3. Rendering
Open the working copy.
- Headings, lists, the table and the code block look right. There is no source toggle and no editing.

### 4. Hostile content
Open `hostile.md`.
- No alert, no script, no network request. The `javascript:` link does nothing.

### R2 · Select and comment (task T-005)

### 5. Menu
Select a sentence by mouse, then another by Shift+arrow keys.
- A menu with Comment appears just below the selection and never covers it. A click without selecting shows nothing.

### 6. Keyboard flow
Select text, press Cmd+Shift+M, type a comment, press Cmd+Enter. Repeat and press Esc instead.
- The comment saves with Cmd+Enter. Esc closes the composer, focus returns to the document and the selection is still
  there. Tab reaches the menu with a visible focus ring. Note any macOS shortcut clash.

### 7. Refused selections
Select a phrase that appears twice (`repeated-text.md`). Then select across two paragraphs.
- The first says the selection matches several places and asks for more text, and nothing is saved. Selecting more
  context makes it saveable. The second says it is not supported, and nothing is saved.

### 8. Highlight and jump
Add three comments, then click each in the panel.
- Each passage is highlighted. Clicking a comment scrolls to its passage. If the highlight is missing, note the macOS
  version (spec Q1) and check the panel still shows the quote.

### R3 · Persist comments (task T-006)

### 9. Restart
Add comments with awkward text (leading spaces, backticks, an emoji). Quit the app fully, reopen it and open the same file.
- Every comment is back exactly as typed, with the same highlights. Edit one and delete one, quit, reopen: both changes held.

### 10. Changed file
Quit. Edit the working copy outside the app: change a commented sentence, and change another one only slightly. Reopen it.
- Comments show as out of date. The one whose text is gone shows as not found, with no guessed target. Nothing is
  rewritten or moved automatically.

### R4 · Copy feedback (task T-007)

### 11. LLM handoff
Add three comments, open the export panel and copy. Paste the prompt and the source file into a real LLM chat.
- The panel text and the clipboard text are identical. Every comment appears word for word, in document order, with the
  right section name and lines. The model can act on it and does not invent changes to other sections. Add a note on
  anything the model misread.

### 12. Offline and source unchanged
With Wi-Fi off, run cases 1, 5, 6, 9 and 11 again. Then run `shasum -a 256` on the working copy.
- Everything works offline. The hash matches the one noted in Setup.

## Watch for

- Highlights that land one character off, especially after emoji or accents.
- The floating menu stealing focus or losing the selection.
- A comment that looks saved but is gone after a relaunch (also check the app data folder:
  `~/Library/Application Support/local.llm-review-workspace/annotations/`).
- A prompt that differs between the panel and the clipboard.

## Known and accepted

- **Comment only:** Replace, Remove, Expand, Question and Approve have no UI yet. They come later.
- **One file, no project:** projects, tabs and the editor are F3.
- **Moved or renamed files:** treated as a new document, so its comments do not follow.
- **Entity and escape text** may highlight a wider range than selected.

## Quick pass / fail summary

| # | Release | Area | Pass / Fail | Notes |
|---|---|---|---|---|
| 1 | R1a | Open and cancel | Pass (reported) | |
| 2 | R1a | Bad files | Pass (reported) | |
| 3 | R1b | Rendering | Pass (reported) | |
| 4 | R1b | Hostile content | Pass (reported) | |
| 5 | R2 | Menu | Pass (reported) | |
| 6 | R2 | Keyboard flow | Pass (reported) | |
| 7 | R2 | Refused selections | Pass (reported) | |
| 8 | R2 | Highlight and jump | Pass (reported) | |
| 9 | R3 | Restart | Pass (reported) | |
| 10 | R3 | Changed file | Pass (reported) | |
| 11 | R4 | LLM handoff | Pass (reported) | |
| 12 | all | Offline and source unchanged | Pass (reported) | |
