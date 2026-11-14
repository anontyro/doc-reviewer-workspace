# 0002 · Rust domain types are canonical, and JSON Schema and TypeScript types are generated from them

**Status:** Agreed · **Work items:** T-002 · **Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` D6–D8, D10, D11

The persisted model (PRD §8.3 entities, §6.3 anchor, §7.3 manifest) is defined once, as Rust types in
`src-tauri/src/domain/`. `cargo run --bin gen_schemas` writes `schemas/v1/domain.schema.json` and
`schemas/v1/export-manifest.schema.json`, and `pnpm run gen:types` writes TypeScript types into
`src/domain/generated/`. All three outputs are committed and nobody edits them by hand.

- **Drift is a test failure.** `tests/schema_drift.rs` fails if a committed schema differs from freshly generated output.
  Regenerating TS types leaves no diff.
- **Validate at every boundary.** `src/domain/validate.ts` validates a value against the generated schema with `ajv`.
  Rust rejects bad values on deserialise. Both reject unknown enum values, a wrong id prefix and missing required fields.
- **Ids are prefixed strings.** `proj_`, `doc_`, `ver_`, `rnd_`, `rev_`, `exp_` followed by at least one character,
  enforced in Rust and by a schema `pattern`. The PRD's `project_001` example becomes `proj_001`. This record only
  defines the types. Generating ids belongs to F2.
- **Anchor shape.** `exact`, `prefix`, `suffix`, `heading_path`, an optional derived `source_range`, `source_hash` and
  `confidence`. Line numbers appear only in the export manifest target, never in the stored anchor.
- **Recommended, not confirmed (PRD §0).** These values are encoded as the PRD recommends. If the owner changes any,
  edit the Rust enum and regenerate:
  - `AnnotationAction`: comment, replace, remove, expand, question, approve
  - `AnnotationStatus`: open, resolved, superseded
  - `AnchorConfidence`: resolved, ambiguous, orphaned
  - `DocumentFormat`: markdown, pdf
- **Left as free text.** `DocumentVersion.origin`, `ReviewRound.state` and `ExportSnapshot.format` are strings because
  the PRD names the fields but not their values. F4 defines them. Timestamps are unparsed RFC 3339 strings until
  persistence needs real parsing.

## Why

One definition removes the main way the UI and the Rust engine can disagree about stored data. Generating from Rust was
chosen over hand-written TS or schema-first because Rust owns persistence and the export engine (PRD §10.2). Two
generated TS files are kept, not one, because both schemas define shared types and a single file would declare them twice.

## Consequences

- Changing a type means running both generators, or the drift test fails.
- Dependencies added: Rust `serde`, `serde_json`, `schemars`, and dev-only `sha2`. Web dev: `json-schema-to-typescript`
  and `ajv`.
- `ajv` is configured with `uint32` and `uint64` formats because `schemars` emits them for Rust integers.
