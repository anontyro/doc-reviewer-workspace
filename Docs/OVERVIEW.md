# Delivery overview

The index between the PRD and the feature specs. Read this first. For product intent read
[the PRD](llm_review_workspace_prd.md); for what is being built right now, follow the spec link in the feature table.

**Baseline:** PRD 1.0 (2026-11-06). **Updated:** 2026-11-20.
**Rule:** the PRD is a controlled baseline. If a spec finds a conflicting assumption, record it in that feature's
`Decisions/` and add a revision note to the PRD. Do not edit requirements silently (PRD §17).

## How the documents fit together

```
PRD (what and why)  →  this overview (order, gates, traceability)  →  Docs/<Feature>/Specs (how, per feature)
                                                                      ├─ Decisions/  rules the code follows
                                                                      ├─ Testing/    manual end-to-end checklist
                                                                      └─ Design/     mockups and spike reports it cites
```

Feature folders live directly under `Docs/` (for example `Docs/FoundationSpike/`). Mockups `01`–`05` stay in `Docs/`
for now. A feature copies the ones it cites into its own `Design/` when it is specced.

## Features

Each feature maps to one PRD milestone. Only the next feature is specced. Later ones are specced when the previous
gate passes, because earlier spike results change their shape.

| # | Feature folder | Milestone | PRD tasks | Exit gate (PRD) | Spec | Status |
|---|---|---|---|---|---|---|
| F1 | `FoundationSpike` | M0 | T-001, T-002, T-003 | Key risks understood or mitigated (§12.2) | [F1 spec](FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md) | Done |
| F2 | `MarkdownPrototype` | M1 | T-004, T-005, T-006, T-007 | Real LLM handoff works; no comments lost on restart (§5.1) | [F2 spec](MarkdownPrototype/Specs/2026-11-20-F2-markdown-prototype.md) | Done |
| F3 | `ProjectsAndPersistence` | M2 → v0.1 alpha | T-008, T-009, T-010, T-016 | Review resumes after restart; real project managed safely (§5.2) | [F3 spec](ProjectsAndPersistence/Specs/2026-11-20-F3-projects-and-persistence.md) | Spec drafted, awaiting approval |
| F4 | `ExportAndVersions` | M3 → v0.1.0 | T-011, T-012, T-013, T-014, T-015 | One reliable two-version LLM cycle; no data loss (§5.3) | not written | Blocked on F3 |
| F5 | `PdfReview` | M4 → v0.2.0 | T-017, T-018 | Markdown and text PDFs reviewed and exported reliably (§5.4) | not written | Blocked on F4 |

**Deferred, no specs yet:** T-019 visual diff (M5), T-020 accessibility and performance baseline (spans F3 to F5),
T-021 DOCX/XLSX spikes (M6/M7), AI assist (M8). See PRD §5.5 and §16.

## Spike items (PRD §10.5)

| PRD spike | Lands in |
|---|---|
| 1. Rendered selection → canonical source range | F1 (T-003) |
| 2. Reopen / re-render / re-edit anchor resolution | F1 (T-003, static fixtures) and F4 (T-015, edits) |
| 3. Floating toolbar focus and placement in WKWebView | F2 (T-005) |
| 4. PDF.js selection and coordinates in Tauri | F5 (T-017) |
| 5. Metadata + snapshot + export under simulated crashes | F3 (T-016) |

## PRD open questions and where each is settled

| PRD §15.3 question | Settled in |
|---|---|
| Markdown dialect and source-map approach | F1 decision 0004 |
| Where anchors are computed (TS or Rust) | F1 decision 0004 |
| Storage metadata format (JSON, SQLite-in-project, hybrid) | F3 (project persistence) |
| Quick Open sessions saved without a project | F3 |
| Project deletion: library entry vs filesystem | F3 |
| Import copy-by-default and duplicate names | F3 |
| Unsaved edits when creating a new version | F4 |
| PDF selection geometry at different zoom levels | F5 |
| Benchmark hardware and fixture sizes | T-020, before any timing becomes a gate |
| Product name, signing and notarisation | Not needed before public distribution |

## Acceptance tests by feature (PRD §11.2)

| AT | Proved in |
|---|---|
| AT-01 Anchor persistence | F2 (single doc), F3 (project) |
| AT-02 No destructive render | F1 fixtures, F2 reader |
| AT-03 Export exactness · AT-04 Preview parity | F4 |
| AT-05 Version reimport | F4 |
| AT-06 External edits | F3 |
| AT-07 Ambiguity | F4 (anchor hardening), seeded by F1 fixtures |
| AT-08 Package | F4 |
| AT-09 Offline | F1 (app builds and runs offline), F4 (full loop) |
| AT-10 PDF | F5 |

## Release gates

Follow PRD §13.3 at each milestone: confirm scope, pass the acceptance checks with the full web and Rust suites green, confirm data safety and export
correctness, update the changelog and schema docs, tag the SemVer release (`0.1.0-alpha.1` → `0.1.0`), then use it
and route issues into the next patch or milestone. App version and `schema_version` are independent.
