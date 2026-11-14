# Manual testing: Foundation and Markdown source-map spike (F1)

**Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md`
**Branch / PR:** `feature/F1-foundation-spike`
**Work items:** F1 · tasks T-001 (R1), T-002 (R2), T-003 (R3)
**Environment:** a macOS development machine running `pnpm run tauri dev` and a debug build. No test server.
**Covers:** all releases. Automated checks are not repeated here. This covers what only a real macOS WKWebView shows.

## What changed

### R1 · Bootstrap (task T-001)

- **Native shell.** A macOS window opens with the app heading and no network access needed.

### R2 · Domain types (task T-002)

- **No visible change.** Types and schemas exist in code. Check only that the app still runs.

### R3 · Source-map spike (task T-003)

- **Spike view (dev only).** Pick a Markdown fixture, pick an engine (TypeScript or Rust), select text, and see the
  resolved source range, confidence and heading path.

## Setup

- Node and the Rust toolchain installed. Run `pnpm install --frozen-lockfile` once.
- Turn Wi-Fi off for cases 1 and 2.
- Fixtures: `fixtures/markdown/*.md`. Note the file hashes with `shasum -a 256 fixtures/markdown/*.md` before starting.

## Change checklist

| ✓ | Release | Work item | Change | Spec ref | Test case |
|---|---|---|---|---|---|
| ☐ | R1 | T-001 | Window builds and opens offline | D2, D5 | 1, 2 |
| ☐ | R2 | T-002 | App still runs with domain module | D6 | 2 |
| ☐ | R3 | T-003 | Selection resolves to source range in WKWebView | D13, D15 | 3, 4, 5 |
| ☐ | R3 | T-003 | Ambiguous selection is flagged, not guessed | D15 | 5 |
| ☐ | R3 | T-003 | Fixtures are not modified | D14, D15 | 6 |
| ☐ | R3 | T-003 | Spike view absent from release build | D18 | 7 |

## Test cases

### R1 · Bootstrap (task T-001)

### 1. Debug build offline
With the network off, run `pnpm tauri build --debug` once online beforehand if needed, then launch the `.app`.
- The window opens and shows the app heading.
- Nothing prompts for network access.

### R2 · Domain types (task T-002)

### 2. Launch with dev server
Run `pnpm run tauri dev` with the network off.
- The window opens, and the terminal shows no errors from the Rust or Vite sides.

### R3 · Source-map spike (task T-003)

### 3. Plain selection
In the spike view, open `small.md`, select a sentence inside one paragraph, with each engine.
- The resolved range slices to exactly the selected text in the source.
- Confidence is `resolved`, and the heading path matches the section.

### 4. Hard structures
With each engine select text inside a nested list item, a table cell, a code fence, a link label, a line with
non-BMP characters (`unicode.md`) and a line in `crlf.md`.
- Each range matches the selected source text, or the view says why it could not.
- Selecting across a block boundary gives a sensible result or a clear "not supported" message, never a wrong range.

### 5. Repeated text
Open `repeated-text.md` and `duplicate-headings.md`, and select a phrase that appears more than once.
- Confidence is `ambiguous` and the view shows the candidate matches. It does not silently pick one.
- Adding more surrounding text to the selection can make it `resolved`.

### 6. Fixtures unchanged
Re-run `shasum -a 256 fixtures/markdown/*.md` after the whole session.
- Every hash matches the one recorded in Setup.

### 7. Release build
Run `pnpm run tauri build` (release) and open the app.
- The spike view is not reachable, and no spike commands are listed in the app.
- `hostile.md` is not reachable either.

### N. Hostile content
In the debug build, open `hostile.md` in the spike view with each engine.
- No script runs, no alert appears and no remote request is made. Links with `javascript:` are inert.

## Watch for

- Differences between the TS and Rust engines on the same selection. Record them in the spike report.
- Selections that look right but end one character early or late (UTF-16 against byte offsets).
- A slow first selection through the Tauri command compared with TS. Note it. It is not a gate.

## Known and accepted

- **Toolbar and comments:** not built. They belong to F2.
- **Editing source and reanchoring:** F4.
- **Timings:** noted for the report only. No performance gate exists until T-020 sets the benchmark hardware.

## Quick pass / fail summary

| # | Release | Area | Pass / Fail | Notes |
|---|---|---|---|---|
| 1 | R1 | Offline debug build | | |
| 2 | R2 | Launch with domain module | | |
| 3 | R3 | Plain selection | | |
| 4 | R3 | Hard structures | | |
| 5 | R3 | Repeated text | | |
| 6 | R3 | Fixtures unchanged | | |
| 7 | R3 | Release build | | |
| 8 | R3 | Hostile content | | |
