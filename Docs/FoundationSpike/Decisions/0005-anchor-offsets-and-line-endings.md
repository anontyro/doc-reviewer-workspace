# 0005 · `source_range` is UTF-8 byte offsets, half-open, over the file exactly as stored

**Status:** Agreed · **Work items:** T-003 · **Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` D11, D15

`source_range { start, end }` counts UTF-8 bytes from the start of the stored file, `start` inclusive and `end`
exclusive. Rust produces and consumes it. The UI never slices the source with it.

- **CRLF.** The source is never normalised. `\r\n` counts as two bytes in a range, so a range slices the original bytes.
  For matching, a line break (LF or CRLF) reads as one space.
- **Non-BMP and accents.** Offsets are bytes, so an emoji is 4 bytes and `é` is 2. Matching works on characters, so a
  selection never splits one.
- **Markup at the edges** is excluded and markup inside the selection is included.
- **Who converts.** Only the UI, and only if it needs UTF-16 for display. Rust stays in bytes.

## Why

The file on disk and the export engine are bytes, and Rust slicing by byte offset is exact. UTF-16 offsets would need a
conversion at every Rust boundary.

The unit is backed by the fixture cases `unicode-accents` (`[17,32]` bytes against `[16,28]` UTF-16),
`unicode-astral-emoji` (`[60,74]` against `[50,62]`) and `unicode-japanese-and-emoji` (`[89,117]` against `[69,79]`),
plus `crlf-across-soft-break` and `crlf-later-paragraph`. The Rust test compares against the byte column, and the
TypeScript engine compares against the UTF-16 column. A swap of units fails those cases in both. The fixture test
`exercises the byte-vs-UTF-16 difference` fails if the cases stop differing.

## Consequences

- Every stored anchor needs its bytes valid for that exact file version. A file edited outside the app invalidates the
  range, so re-anchoring uses `exact`, `prefix` and `suffix`, not the offsets alone (F4).
- Rust must handle a selection that starts or ends inside a multi-byte character by refusing it, not rounding.
