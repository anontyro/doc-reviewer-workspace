# 0004 · Markdown is rendered and anchors are resolved in Rust with comrak

**Status:** Agreed · **Work items:** T-003 · **Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` D12, D13, D15, D17

Engine B (Rust, `comrak` with `data-sourcepos`) is the Markdown pipeline and the anchor resolver. The TypeScript engine
(unified and remark) is rejected.

- **Rule applied.** Both engines passed all 28 cases (A: `pnpm test`, B: `cargo test --test spike_cases`), so D17's
  tie-break picks Rust. See `Design/markdown-source-map-report.md`.
- **Contract.** Rendered blocks carry `data-sourcepos="l1:c1-l2:c2"`. The UI captures the selection (`captureSelection`:
  selected text plus up to 40 characters of context in the same block) and sends it to Rust, which returns
  `resolved` with one range, `ambiguous` with a candidate count and no range, or `orphaned`.
- **Sanitising.** comrak's safe mode (raw HTML omitted, `javascript:` links dropped) is the sanitiser. No separate HTML
  sanitiser crate is added. The hostile fixture test is the proof. If F2 turns on any comrak option that allows raw
  HTML, a sanitiser must be added first.
- **Dialect.** CommonMark plus GFM tables and strikethrough.

## Why

The export engine and anchor resolution against a version already live in Rust (PRD §10.2), so one implementation avoids
keeping two in step. The tie-break was agreed before the spike (Q2).

## Consequences

- F2 deletes engine A's files (listed in the report) and promotes `src-tauri/src/spike/` into a real module.
- Selection tests for the real DOM stay in the web lane; resolution tests stay in `cargo test` against the shared fixtures.
- Entity and escape text resolves only to its node (coarse). F2 must refine it or add a fixture that proves it is fine.
- The result rests on small fixtures and no WKWebView run yet. If the manual run finds a failure Rust can't fix, reopen
  this decision.
