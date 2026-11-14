# Foundation and Markdown source-map spike

Work item: F1 (PRD milestone M0). Releases map to these tasks:

| Release | Task |
|---|---|
| R1 · Bootstrap | T-001 |
| R2 · Domain types | T-002 |
| R3 · Source-map spike | T-003 |

Branch: `feature/F1-foundation-spike`.
Status: **approved 2026-11-13**.
Manual testing: `Docs/FoundationSpike/Testing/MANUAL-TESTING-F1-foundation-spike.md`.
Decisions: `Docs/FoundationSpike/Decisions/` (README lists every planned record and the package that writes it).

## Goal

Afterwards there is a Tauri 2 app that builds and opens offline on macOS, a typed domain model with generated JSON
Schemas, and a measured answer to PRD risk #1: whether rendered-Markdown selection maps reliably to source ranges, and
whether that work belongs in TypeScript or Rust.

| Release | What ships |
|---|---|
| **R1** | Empty native window, with lint, format, typecheck and test commands for both languages. |
| **R2** | Domain entities, anchor and export-manifest types in Rust, generated JSON Schemas and TS types, schema-version check. |
| **R3** | Two comparable Markdown source-map implementations (TS and Rust), shared fixtures, a dev-only spike view, a report and the decision. |

## Background (read 2026-11-13)

- The repo has no code. `Docs/llm_review_workspace_prd.md` is the baseline. Relevant parts: §6.3 anchoring, §7.3
  manifest, §8.3 entities, §10.5 spikes, §11.1 fixture matrix, §11.2 AT-02/AT-07, §12.3 T-001..T-003.
- PRD §10.3 lists CodeMirror, comrak-class renderers and `unified`-class renderers only as candidates. Nothing is
  chosen. This spec chooses **only** what the spike must compare and the tooling needed to run it.
- PRD §6.3: line numbers and source ranges are derived helpers, never sole identity. Identity is document id, version
  id, exact quote, prefix/suffix context and heading path.
- PRD §0: Recommended items (status enums, `.review-workspace/` layout, manifest schema) must not become binding by
  accident. See Q3.

## Decisions

### R1 · Bootstrap, plus decisions shared by every release

> **R1 · T-001 · ~22 files: ~21 new, ~1 modified · packages P1–P2** (generated app icons under `src-tauri/icons/` are
> not counted)
>
> The user gets an empty macOS window that builds and opens with no network. In the code, the repo gains the Vite +
> React + TypeScript web shell, the Tauri 2 Rust shell, and the check commands every later feature runs.

- **D1 · Layout.** Web shell at the repo root (`src/`, `package.json`), Rust at `src-tauri/`, generated schemas at
  `schemas/`, shared fixtures at `fixtures/`. No Rust workspace and no monorepo tooling.
- **D2 · Check commands (fixed names).** package scripts `typecheck` (`tsc --noEmit`), `lint` (ESLint), `format:check`
  (Prettier), `test` (Vitest), plus the Tauri scripts `tauri dev` and `tauri build`. Rust uses `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings` and `cargo test`, run from `src-tauri/`. These match `CLAUDE.md`.
- **D3 · Package manager.** pnpm, with `pnpm-lock.yaml` committed (Q1).
- **D4 · Minimal permissions.** The default Tauri capability grants only what the empty window needs. No `shell`,
  `http` or broad `fs` plugins (PRD §7.5). Later features add scoped permissions in their own specs.
- **D5 · Offline.** No runtime fetch of fonts, scripts or styles. The app makes no network calls.

### R2 · Domain types

> **R2 · T-002 · ~19 files: ~14 new, ~5 modified · packages P3–P4**
>
> Nothing visible changes for the user. In the code, the PRD §8.3 entities, the §6.3 anchor and the §7.3 manifest
> exist as Rust types that emit JSON Schema and TypeScript types, so Rust and the UI cannot disagree on shape.

- **D6 · Rust is canonical.** Types live in `src-tauri/src/domain/` with `serde` and `schemars`. A
  `gen-schemas` binary writes `schemas/v1/domain.schema.json` and `schemas/v1/export-manifest.schema.json`. The
  schemas are committed, and a Rust test fails if the committed files differ from freshly generated output.
- **D7 · TS types are generated.** `pnpm run gen:types` runs `json-schema-to-typescript` over the schemas into
  `src/domain/generated.ts`. Nobody edits that file. Test-time validation uses `ajv`.
- **D8 · IDs.** Typed string newtypes with a prefix: `proj_`, `doc_`, `ver_`, `rnd_`, `rev_`, `exp_`. This spec
  defines the types only. ID generation belongs to F2 (T-006).
- **D9 · Schema versioning.** Every persisted root type carries `schema_version` (SemVer string, starting `1.0.0`),
  independent of the app version. `check_schema_version` accepts the same major version and returns a typed error for
  an unknown major or a malformed value. No migration exists yet. The rule recorded is: back up before any
  incompatible migration, and never drop historical annotations.
- **D10 · Enums follow the PRD recommendations.** `AnnotationAction`: comment, replace, remove, expand, question,
  approve. `AnnotationStatus`: open, resolved, superseded. `AnchorConfidence`: resolved, ambiguous, orphaned.
  `DocumentFormat`: markdown, pdf. They are marked Recommended in decision 0002 (Q3).
- **D11 · Anchor shape.** `Anchor` holds `exact`, `prefix`, `suffix`, `heading_path`, an optional derived
  `source_range`, `source_hash` (document version sha256) and `confidence`. Source range units are decided in
  R3 (decision 0005). Until then `SourceRange` is `{ start: u64, end: u64 }`, with units documented by that decision.

### R3 · Source-map spike

> **R3 · T-003 · ~30 files: ~24 new, ~6 modified · packages P5–P8**
>
> The user can open a dev-only spike view, select text in rendered fixtures and see the resolved source range and
> confidence from either engine. In the code, two engines run against one fixture set and the result is written up.

- **D12 · Two engines, one fixture set.** Engine A: TypeScript (`unified` / `remark-parse` / `remark-rehype` /
  `rehype-sanitize`, resolver in TS). Engine B: Rust (`comrak` with source positions, sanitised output, resolver in
  Rust, exposed to the UI by Tauri commands). Both are deliberately thin and live under `src/spike/` and
  `src-tauri/src/spike/`, so the loser is deleted in F2 with no residue.
- **D13 · Shared contract.** Rendered elements carry `data-sourcepos="l1:c1-l2:c2"` (comrak's format). Engine A emits
  the same attribute. One TS `captureSelection` reads the nearest `data-sourcepos` ancestor plus the selected text and
  context, and both engines resolve that to a `ResolvedAnchor { start, end, confidence, heading_path }`.
- **D14 · Fixtures.** `fixtures/markdown/` holds the PRD §11.1 Markdown set (small, repeated phrases, duplicate
  headings, nested lists, tables, code fences, links, Unicode, CRLF, hostile HTML). `cases.json` lists selection
  cases with the expected source slice, heading path and confidence. A fixture file is never rewritten by any engine.
- **D15 · Pass rule.** An engine passes a case only if it returns the expected confidence and, for `resolved`, the
  exact expected range. Ambiguous cases must return `ambiguous`, never pick one match (AT-07). The hostile fixture
  must render with no executable script, event-handler attribute or `javascript:` link. Source files must be
  byte-identical after load (AT-02). The PRD's ≥95% anchoring target is the scoring bar, but any `resolved` result that
  points at the wrong passage is a failure of that engine regardless of score.
- **D16 · Selection.** Engine tests use `jsdom` ranges. The manual testing document covers real selection in WKWebView.
  Toolbar focus is out of scope here (F2).
- **D17 · Decision rule.** If both engines pass every case, choose Rust. PRD §10.2 puts the deterministic export
  engine in Rust and that engine must resolve anchors against a version anyway, so one implementation is less
  duplication (Q2). Otherwise choose the engine that passes every case. If neither does, the report says so, the
  decision records the gap, and F2 is not specced until it is closed.
- **D18 · Dev-only.** The spike view and Tauri spike commands are registered only under `debug_assertions`, are not
  in release builds, and are labelled as spike code.

## Non-goals

- Any user-facing review feature: toolbar, comments, persistence, export, sidebar, tabs, project folders (F2–F4).
- ID generation, repositories, migrations beyond the version check, SQLite, or the `.review-workspace/` layout.
- A Markdown editor (CodeMirror) or PDF code. Reanchoring after source edits is F4 (T-015).
- Signing, notarisation, packaging, CI configuration, icons beyond the Tauri defaults.

## Lanes

| Lane | Touched | Checks |
|---|---|---|
| `web` | yes | `pnpm run check` (runs typecheck, lint, format:check and test) |
| `rust` | yes | from `src-tauri/`: `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test` |
| `docs` | yes | no automated check. A reviewer reads against the acceptance criteria. |

## Packages

Waves:

| Wave | Packages | Release | Note |
|---|---|---|---|
| 1 | P1, P2 | R1 (T-001) | parallel |
| 2 | P3, P5 | R2 (T-002), R3 (T-003) | parallel |
| 3 | P4, P7 | R2 (T-002), R3 (T-003) | parallel |
| 4 | P6 | R3 (T-003) | after P4 (shares `package.json`) |
| 5 | P8 | R3 (T-003) | after both engines |

Packages that share a wave share no files.

Shared acceptance for every package:

- The lane checks pass for its files, measured against the baseline.
- No test is deleted or skipped to pass a check.
- New logic ships with tests in the same package that would fail if the behaviour broke (real inputs, edge and error
  paths). The full lane suite is green, not only the new tests. A package whose logic has no test reports `blocked`.
- The branch passes the pre-PR audit (spec-plan step 10) before a PR is raised.
- Every new dependency is listed in a decision record. A package that needs one that is not listed reports `blocked`.
- Shared resources are only touched by the package that owns them.

### P1 · Web: Vite + React + TS shell and tooling (R1 · T-001, wave 1)
- Lane: `web`
- ownedFiles:
  - `package.json` (new)
  - `pnpm-lock.yaml` (new)
  - `tsconfig.json` (new)
  - `tsconfig.node.json` (new)
  - `vite.config.ts` (new)
  - `index.html` (new)
  - `eslint.config.js` (new)
  - `.prettierrc` (new)
  - `src/main.tsx` (new)
  - `src/App.tsx` (new)
  - `src/App.test.tsx` (new)
  - `src/vite-env.d.ts` (new)
- Acceptance criteria:
  1. `pnpm run typecheck`, `lint`, `format:check`, `test` and `check` (runs the other four) exist and pass on a clean checkout after `pnpm install --frozen-lockfile`.
  2. `src/App.test.tsx` renders `App` and asserts a visible heading, and the test fails if `App` renders nothing.
  3. `vite.config.ts` includes `src/**` and `fixtures/**` test files in Vitest.
  4. `package.json` defines the `tauri` script and Vite dev port expected by `src-tauri/tauri.conf.json` (D2).
  5. No `fetch`, remote font or CDN URL appears in `index.html` or `src/` (D5).

### P2 · Rust: Tauri 2 shell, permissions and docs (R1 · T-001, wave 1)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/Cargo.toml` (new)
  - `src-tauri/Cargo.lock` (new)
  - `src-tauri/build.rs` (new)
  - `src-tauri/tauri.conf.json` (new)
  - `src-tauri/capabilities/default.json` (new)
  - `src-tauri/src/main.rs` (new)
  - `src-tauri/src/lib.rs` (new)
  - `src-tauri/icons/` (new, generated defaults)
  - `Docs/FoundationSpike/Decisions/0001-tooling-baseline.md` (new)
  - `CLAUDE.md` (edit: Layout and commands section only)
- Acceptance criteria:
  1. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass in `src-tauri/`.
  2. `pnpm tauri build --debug` produces a macOS `.app`, and launching it with the network off shows the window.
  3. `capabilities/default.json` grants no `shell`, `http` or `fs` permission (D4).
  4. `tauri.conf.json` `beforeDevCommand` and `devUrl` match P1's scripts and Vite port.
  5. Decision 0001 records D1–D5 with status Agreed and lists the dependencies added in R1.
  6. `CLAUDE.md` command lines match the scripts that exist. Nothing else in `CLAUDE.md` changes.

### P3 · Rust: domain types and schema generation (R2 · T-002, wave 2)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/Cargo.toml` (edit: `serde`, `serde_json`, `schemars`, `sha2` if needed)
  - `src-tauri/Cargo.lock` (edit)
  - `src-tauri/src/lib.rs` (edit: `mod domain;`)
  - `src-tauri/src/domain/mod.rs` (new)
  - `src-tauri/src/domain/entities.rs` (new)
  - `src-tauri/src/domain/anchor.rs` (new)
  - `src-tauri/src/domain/export.rs` (new)
  - `src-tauri/src/domain/schema_version.rs` (new)
  - `src-tauri/src/bin/gen_schemas.rs` (new)
  - `src-tauri/tests/schema_drift.rs` (new)
  - `schemas/v1/domain.schema.json` (new, generated)
  - `schemas/v1/export-manifest.schema.json` (new, generated)
- Acceptance criteria:
  1. `Project`, `Document`, `DocumentVersion`, `ReviewRound`, `Annotation`, `ExportSnapshot`, `LibraryEntry`, `Anchor`
     and `ExportManifest` exist with the PRD §8.3 and §7.3 essential fields (D6, D8, D10, D11).
  2. `cargo run --bin gen_schemas` regenerates both schema files, and `schema_drift` fails if a committed file differs.
  3. A test serialises the PRD §7.3 example manifest (with a real computed digest) and it round-trips unchanged.
  4. `check_schema_version` accepts `1.x.y`, and returns distinct errors for `2.0.0`, `0.9.0` and `"abc"` (D9).
  5. Deserialising an unknown `AnnotationAction` or `AnchorConfidence` value is an error, not a silent default.

### P4 · Web: generated TS types, schema validation, decisions (R2 · T-002, wave 3)
- Lane: `web`
- ownedFiles:
  - `package.json` (edit: `json-schema-to-typescript`, `ajv`, `gen:types` script)
  - `pnpm-lock.yaml` (edit)
  - `src/domain/generated.ts` (new, generated)
  - `src/domain/validate.ts` (new)
  - `src/domain/validate.test.ts` (new)
  - `fixtures/domain/valid.json` (new)
  - `fixtures/domain/invalid.json` (new)
  - `Docs/FoundationSpike/Decisions/0002-domain-types-canonical-in-rust.md` (new)
  - `Docs/FoundationSpike/Decisions/0003-schema-versioning-and-migration-rule.md` (new)
- Acceptance criteria:
  1. `pnpm run gen:types` regenerates `generated.ts` from `schemas/v1/*.json` and leaves no diff on a clean tree.
  2. `validate.ts` validates a value against the schemas using `ajv`, and every case in `valid.json` passes.
  3. Every case in `invalid.json` is rejected, including a missing `schema_version`, a bad `action` and a missing `exact`.
  4. The Rust-emitted manifest from P3's round-trip test validates against the TS validator (one shared sample file).
  5. Decisions 0002 and 0003 exist with status Agreed, and 0002 marks the D10 enums as Recommended.

### P5 · Fixtures: Markdown set and selection cases (R3 · T-003, wave 2)
- Lane: `web`
- ownedFiles:
  - `fixtures/markdown/small.md` (new)
  - `fixtures/markdown/repeated-text.md` (new)
  - `fixtures/markdown/duplicate-headings.md` (new)
  - `fixtures/markdown/nested-lists.md` (new)
  - `fixtures/markdown/tables.md` (new)
  - `fixtures/markdown/code-fences.md` (new)
  - `fixtures/markdown/links.md` (new)
  - `fixtures/markdown/unicode.md` (new)
  - `fixtures/markdown/crlf.md` (new, CRLF line endings)
  - `fixtures/markdown/hostile.md` (new)
  - `fixtures/markdown/cases.json` (new)
  - `fixtures/markdown/cases.test.ts` (new)
- Acceptance criteria:
  1. `cases.json` has at least one case per fixture file and at least three ambiguous cases (repeated text, duplicate
     headings and a table cell).
  2. `cases.test.ts` fails if a referenced fixture is missing, or if a `resolved` case's expected range does not slice
     exactly its expected source text from the file bytes.
  3. `crlf.md` contains `\r\n` and no bare `\n`, and `unicode.md` contains characters outside the BMP, verified by test.
  4. Every case has `expected.confidence` of `resolved` or `ambiguous` and an expected `heading_path`.

### P7 · Rust: Engine B, comrak render and resolve (R3 · T-003, wave 3)
- Lane: `rust`
- ownedFiles:
  - `src-tauri/Cargo.toml` (edit: `comrak`, HTML sanitiser)
  - `src-tauri/Cargo.lock` (edit)
  - `src-tauri/src/lib.rs` (edit: register spike module and debug-only commands)
  - `src-tauri/src/spike/mod.rs` (new)
  - `src-tauri/src/spike/render.rs` (new)
  - `src-tauri/src/spike/resolve.rs` (new)
  - `src-tauri/tests/spike_cases.rs` (new)
- Acceptance criteria:
  1. `spike_cases` reads `fixtures/markdown/cases.json` and reports pass or fail per case under D15, and prints the totals.
  2. Rendered output carries `data-sourcepos` on block elements (D13) and the hostile fixture produces no script,
     event-handler attribute or `javascript:` URL.
  3. A test hashes each fixture before and after render and resolve and asserts the bytes are unchanged (AT-02).
  4. The commands `spike_render_markdown` and `spike_resolve_anchor` are registered only under `debug_assertions` (D18).
  5. Ambiguous cases return `ambiguous` and never a single guessed range (D15).

### P6 · Web: Engine A, remark render and resolve, spike view (R3 · T-003, wave 4)
- Lane: `web`
- ownedFiles:
  - `package.json` (edit: `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`,
    `rehype-stringify`, `jsdom`)
  - `pnpm-lock.yaml` (edit)
  - `src/App.tsx` (edit: render the spike view in dev builds only)
  - `src/spike/markdown.ts` (new)
  - `src/spike/capture.ts` (new)
  - `src/spike/resolve.ts` (new)
  - `src/spike/SpikeView.tsx` (new)
  - `src/spike/spike.test.ts` (new)
- Acceptance criteria:
  1. `spike.test.ts` runs every case in `fixtures/markdown/cases.json` through Engine A and `captureSelection` using
     `jsdom` ranges, and prints per-case pass or fail and totals (D15, D16).
  2. Engine A emits `data-sourcepos` in the same format as Engine B (D13), and the hostile fixture renders with no
     executable content.
  3. Source file bytes are unchanged after load (AT-02).
  4. `SpikeView` lets a user pick a fixture, switch engine (TS or Rust via Tauri commands), select text, and see the
     resolved range, confidence and heading path. It renders only when `import.meta.env.DEV` is true (D18).
  5. A production `vite build` bundle does not contain `SpikeView`.

### P8 · Docs: spike report and decisions (R3 · T-003, wave 5)
- Lane: `docs`
- ownedFiles:
  - `Docs/FoundationSpike/Design/markdown-source-map-report.md` (new)
  - `Docs/FoundationSpike/Decisions/0004-markdown-pipeline-and-anchor-engine.md` (new)
  - `Docs/FoundationSpike/Decisions/0005-anchor-offsets-and-line-endings.md` (new)
- Acceptance criteria:
  1. The report states per-engine totals that match the actual output of `pnpm test` and `cargo test`, lists every
     failing case with the reason, and records the WKWebView manual results from the testing document.
  2. The report lists the Q-style unknowns it did not resolve, instead of claiming them closed.
  3. Decision 0004 names the chosen engine and applies the D17 rule, citing the totals, or records why it was not met.
  4. Decision 0005 states the units of `source_range` (bytes or UTF-16), how CRLF and non-BMP text are handled, and
     which side converts. The unit choice is backed by a failing-then-passing fixture case.
  5. If an engine was rejected, the report lists the files to delete in F2 under `src/spike/` or `src-tauri/src/spike/`.

## Follow-ups

- PRD spike items 3, 4 and 5 are scheduled in F2, F5 and F3 respectively (see `Docs/OVERVIEW.md`).
- The winning engine is promoted from `spike/` into real modules and the loser deleted at the start of F2.

## Resolved questions

- **Scope → D12.** The first spec is the foundation plus the spike, not the full prototype.
- **Docs location → layout.** Feature folders live directly under `Docs/` (renamed from `docs/` so the validator matches).
- **Anchor location → D12, D17.** Both TS and Rust are measured, and the result decides.
- **Q1 → D3.** pnpm.
- **Q2 → D17.** Rust wins the tie-break if both engines pass.
- **Q3 → D10.** The PRD's recommended enum values are used, flagged as Recommended in decision 0002.

## Open questions

None.
