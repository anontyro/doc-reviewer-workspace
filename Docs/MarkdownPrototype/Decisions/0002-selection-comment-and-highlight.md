# 0002 · A comment is created only from a selection that resolves to one place, and Comment is the only action in the UI

**Status:** Agreed · **Work items:** T-005 · **Spec:** `Docs/MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md` D10–D14

- **Menu.** After a non-empty selection inside one block of the reader, made by mouse (on mouse up) or keyboard (on key
  up), a floating menu appears below the selection, or above it when there is no room. It never covers the selected
  text. It offers **Comment** only. The model still stores all six `action_type` values, so adding the others later
  needs no migration. The menu's button does not take focus on mouse down, so the selection survives the click.
- **Keyboard (recommended, not confirmed, PRD §6.1).** `Cmd+Shift+M` opens the composer for the current selection,
  `Cmd+Enter` saves, `Esc` closes it. After closing, by save or cancel, focus and the original selection go back to
  the document. The menu and composer are in tab order and show a focus ring. The shortcut may clash with a macOS
  menu item, which has not been checked.
- **Fail closed.** The composer first asks Rust to resolve the selection. Only `resolved` shows the text box.
  `ambiguous` says how many places match and asks for more text. `orphaned` says the text was not found. A selection
  across blocks says it is not supported. None of them creates a comment, and empty or whitespace-only text cannot be saved.
- **Highlight.** Highlights use the CSS Custom Highlight API. A comment is highlighted only if its prefix, quote and
  suffix occur exactly once in the rendered page, inside one block. A context shorter than the 40-character capture
  limit means the quote sat at that edge of its block, so it has to match there. Without the API nothing is painted
  and the panel still shows the quote. Clicking a comment in the panel selects its passage, scrolls to it and
  focuses the document, and does nothing when there is no unique match.
- **Verbatim.** The panel shows the comment exactly as typed, with `white-space: pre-wrap`.
- **In memory first.** Until R3, comments live in `useAnnotations` with temporary ids and are lost on restart. R3
  swaps the storage and keeps the hook's shape.

## Why

A wrongly placed comment is worse than a refused one: it sends a model to the wrong passage (PRD §6.3, AT-07). The same
exactly-once rule is used for creating and for painting, so the page never highlights something Rust would call
ambiguous. Comment-only keeps the first slice small, which the PRD's "default action Comment" allows.

## Consequences

- The highlight matcher (TypeScript, in the DOM) and the resolver (Rust, on the source) are two implementations of
  "find this quote". They agree on the shared cases, but they can disagree on odd text such as entities. The panel's
  anchor state in R3 comes from Rust, and the highlight is cosmetic.
- Whether the Custom Highlight API exists in the target WKWebView is not confirmed (spec Q1). Manual case 8 records it.
- A selection made inside the composer text box is not part of the document and is never captured.
