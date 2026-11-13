# FoundationSpike decisions

The rules the foundation and Markdown source-map spike are built on, one per file. Each file says what the code does
and why. For how it does it, read the code.

**Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` · **Manual testing:** `../Testing/MANUAL-TESTING-F1-foundation-spike.md` · **Work item:** F1

## How to use this folder

- **Change a decision in the same PR as the code.** The review then checks the diff against the rule written here.
- **Edit the file in place when a decision changes.** Git keeps the history, so don't add dated amendments or
  "previously" notes.
- **Add a new decision under the next number** and list it below. Numbers are never reused. A dropped decision's file
  is deleted.
- **Cite decisions by number**, for example "FoundationSpike decision 0004", in PRs, work items and reviews.

| Status | Means |
|---|---|
| Agreed | The contract is settled, but the code isn't in master yet |
| Accepted | Built and in master |

## R1 · Bootstrap (T-001)

| # | Decision |
|---|---|
| [0001](0001-tooling-baseline.md) | Web at the repo root, Rust in `src-tauri/`, fixed check commands, pnpm, minimal Tauri permissions, no network at runtime. |

## R2 · Domain types (T-002)

| # | Decision |
|---|---|
| [0002](0002-domain-types-canonical-in-rust.md) | Rust types are canonical. JSON Schema and TypeScript types are generated from them, and the PRD's recommended enums are marked as such. |
| [0003](0003-schema-versioning-and-migration-rule.md) | Persisted data carries a SemVer `schema_version` separate from the app version. Back up before any incompatible migration. |

## R3 · Source-map spike (T-003)

| # | Decision |
|---|---|
| [0004](0004-markdown-pipeline-and-anchor-engine.md) | Which Markdown pipeline and which side (TS or Rust) computes anchors, chosen by measured fixture results. |
| [0005](0005-anchor-offsets-and-line-endings.md) | Units of `source_range`, and how CRLF and non-BMP text are handled. |

## Open questions

Not decided yet. Each one becomes a numbered file once it is.

- **Which engine wins?** Decided by the spike. See 0004.
