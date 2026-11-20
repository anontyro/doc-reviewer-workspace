# Markdown source-map spike report

**Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` (R3, T-003) · **Decisions:** 0004, 0005
**Date:** 2026-11-14

## Result

Both engines pass every case in `fixtures/markdown/cases.json`. By decision rule D17, Rust wins.

| Engine | Pipeline | Command | Cases passed |
|---|---|---|---|
| A (TypeScript) | unified, remark-parse, remark-gfm, remark-rehype, rehype-sanitize | `pnpm test` (`src/spike/spike.test.ts`) | 28 / 28 |
| B (Rust) | comrak 0.59, safe mode | `cargo test --test spike_cases -- --nocapture` | 28 / 28 |

Failing cases: none. Totals are the printed output of those commands on 2026-11-14.

Both tests also assert that fixtures are byte-identical after the run, that ambiguous cases return no range, and that
`hostile.md` renders with no `<script>`, event-handler attribute or `javascript:` link. Breaking the range end offset in
either engine drops it to 5 / 28, so the cases do detect a wrong range.

## What the cases cover

28 cases over 10 fixtures: plain text, repeated and duplicate-heading text (5 ambiguous cases), nested lists, tables,
code fences, links, Unicode (accents, astral emoji, Japanese), CRLF and hostile HTML.

## Differences between the engines

| Topic | A (TS) | B (Rust) |
|---|---|---|
| `source_range` unit | UTF-16 code units | UTF-8 bytes |
| `data-sourcepos` columns | UTF-16, from remark | bytes, from comrak |
| Selection input | real DOM range through `captureSelection` (jsdom) | text plus context, simulated in the test |
| CRLF | remark keeps `\r\n` in text, resolver folds it to one space | comrak positions are byte columns, source is sliced as is |
| Code fence text | trailing newline dropped by mdast, resolver adds it back | kept |
| List item text | DOM text includes the nested list, capture stops before it | no issue, paragraph nodes are separate |
| Raw HTML and `javascript:` | `rehype-sanitize` (an extra dependency) | comrak safe mode, no extra crate |

Each TS difference above caused a failing case during the build and was fixed in `capture.ts` or `resolve.ts`.

## WKWebView manual results

Run by the project owner on 2026-11-20 in `pnpm tauri dev`. They reported the manual testing document as passing and
the app as fine. No per-case notes or timings were recorded, so differences between the engines in WKWebView, if any,
are not documented.

| # | Area | Pass / Fail | Notes |
|---|---|---|---|
| 1-8 | see the testing document | Pass (reported) | no per-case notes |

## Unresolved unknowns

- **Real selection in WKWebView.** Reported as passing, without per-case notes. Edge cases (cross-block, entities) were not
  recorded one by one.
- **Entities and escapes.** When rendered text differs from the source (`&amp;`, `\*`), both engines map every character
  to the whole node, so a range is the node, not the exact characters. No fixture covers it.
- **Fixtures were written by the same author as the engines.** 28 / 28 is a good sign, not proof against real LLM
  output. F2 should add real documents.
- **Cross-block selections** are refused by `captureSelection` rather than resolved.
- **`data-sourcepos` column units** differ for non-ASCII text. Nothing reads it yet, so it is not a problem until the
  toolbar or anything else uses it.
- **Speed.** The Tauri command round trip was not timed. No performance gate exists until T-020.
- **Soft line breaks** read as a space. A selection that covers a hard break (`\n`) is only lightly tested.

## Files to delete in F2

Engine A loses, so F2 deletes these and keeps the `fixtures/markdown/` set, which both sides' tests share:

- `src/spike/markdown.ts`, `src/spike/resolve.ts`, `src/spike/spike.test.ts`
- `src/spike/SpikeView.tsx` and its mount in `src/App.tsx` (or rewrite it to call only Rust)
- npm dependencies `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify`,
  `jsdom`, `@types/jsdom`, `@types/mdast`, `@types/hast`

Keep `src/spike/capture.ts` (the DOM side is needed whichever engine resolves). Promote `src-tauri/src/spike/` into a
real module and keep its debug-only gating until a production command replaces it.
