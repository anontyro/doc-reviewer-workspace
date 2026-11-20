# MarkdownPrototype decisions

The rules the Markdown review prototype is built on, one per file. Each file says what the code does and why. For how it
does it, read the code.

**Spec:** `Docs/MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md` · **Manual testing:** `../Testing/MANUAL-TESTING-F2-markdown-prototype.md` · **Work item:** F2

## How to use this folder

- **Change a decision in the same PR as the code.** The review then checks the diff against the rule written here.
- **Edit the file in place when a decision changes.** Git keeps the history, so don't add dated amendments or
  "previously" notes.
- **Add a new decision under the next number** and list it below. Numbers are never reused. A dropped decision's file
  is deleted.
- **Cite decisions by number**, for example "MarkdownPrototype decision 0003", in PRs, work items and reviews.

| Status | Means |
|---|---|
| Agreed | The contract is settled, but the code isn't in master yet |
| Accepted | Built and in master |

## R1 · Open and render (T-004)

| # | Decision | Written by |
|---|---|---|
| [0001](0001-reader-and-open-file-commands.md) | Rust opens files through a native dialog with no web-side file permission, holds the open document, and the web side calls Rust only through `src/api.ts`. | P2 |

## R2 · Select and comment (T-005)

| # | Decision | Written by |
|---|---|---|
| [0002](0002-selection-comment-and-highlight.md) | A comment is created only from a `resolved` selection. Comment is the only UI action, with recommended shortcuts and an exactly-once highlight rule. | P3 |

## R3 · Persist comments (T-006)

| # | Decision | Written by |
|---|---|---|
| [0003](0003-annotation-storage-ids-and-atomic-writes.md) | One atomically written JSON file per document in app data, never overwriting an unreadable or newer file, with sequence ids that are never reused. | P5 |

## R4 · Copy feedback (T-007)

| # | Decision | Written by |
|---|---|---|
| [0004](0004-feedback-prompt-format.md) | The feedback prompt is a pure, deterministic function, and quotes and comments sit in length-safe fences so they stay verbatim. | P7 |

## After F2 completion

| # | Decision | Written by |
|---|---|---|
| [0005](0005-browser-e2e-with-playwright.md) | A small Playwright suite runs the web UI in Chromium and WebKit with the Rust side faked, on demand, outside `pnpm run check`. | Post-completion change |
