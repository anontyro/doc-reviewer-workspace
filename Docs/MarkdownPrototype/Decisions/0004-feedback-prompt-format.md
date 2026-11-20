# 0004 · The feedback prompt is a pure function with length-safe fences, and the panel copies exactly what it shows

**Status:** Agreed · **Work items:** T-007 · **Spec:** `Docs/MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md` D21–D25

- **Pure.** `feedback::build_feedback` depends only on the document name, version id, source hash, source text and
  the annotation views. It reads no clock and makes no random value. The same input gives the same bytes, in any input order.
- **What is in it.** Only annotations with status `open`. They are ordered by where their quote is now in the text,
  then by id, and ones with no single place come last. `resolved` and `superseded` comments are kept in storage and left
  out of the prompt.
- **Shape.** `# Review Instructions`, `Document:`, `Source: version <ver_id>, sha256 <hash>`, a fixed `## Instructions`
  block (apply only the requested revisions, preserve everything else, report an ambiguous or conflicting target
  instead of guessing), then `## Comments` with one `### rev_NNNN — COMMENT` section per comment: `Section:` (heading
  path joined by ` > `), `Source lines:` (1-based, from the current text), then `Context before`, `Quote`,
  `Context after` and `User instruction (verbatim)`, each in a fence. With no open comments it says
  "There are no comments." and keeps the instruction block. The exact text is fixed by the files in `fixtures/export/`.
- **Disclosure.** A comment that matches several places, or none, gets a `WARNING` line and no source lines. A comment
  made on an earlier version of the file gets a `WARNING` line, and keeps its lines if its quote still has one place.
  Nothing is guessed (PRD §6.3, AT-07).
- **Verbatim.** Each field sits in a fence one backtick longer than the longest run of backticks inside it, at least
  three. Nothing is escaped, trimmed or normalised. This departs from PRD §7.2's inline quotes on purpose: a quote or
  comment containing a quote mark or backticks cannot break the structure, and the model receives the user's words exactly.
- **Panel and clipboard.** The panel shows the string from `generate_feedback`, and Copy writes that same string with
  `navigator.clipboard.writeText` from a click. No clipboard plugin or permission is added. While open it regenerates
  whenever the comments change. A command or clipboard error is shown and nothing is copied.

## Why

The prompt is what a model acts on, so a wrong target or an altered comment is worse than no prompt (PRD §7.1,
§11.3). A pure function with byte-for-byte snapshot files makes any change to the wording a visible diff. Showing and
copying the same string is the cheapest way to meet AT-04.

## Consequences

- Changing the wording means editing the snapshot files in the same change, on purpose.
- The prompt has no export id, timestamp or token estimate. Export snapshots and previews with those belong to F4 (T-012, T-013).
- A real LLM may still misread the fenced layout. Manual case 11 checks that, and the instruction block is the first thing to tune.
- Line numbers refer to the file as it is now, not as it was when the comment was made.
