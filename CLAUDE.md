# LLM Review Workspace

Local-first macOS utility (Tauri 2 + Rust + React/TypeScript, pnpm) for reviewing LLM-generated documents, attaching precise
anchored feedback, exporting deterministic instructions back to an LLM, and tracking document versions in portable
project folders. Working title only. Solo developer, AI-assisted, ~3-5 h/week.

## Source of truth

- Product: `Docs/llm_review_workspace_prd.md` (PRD 1.0, controlled baseline). Mockups: `Docs/0N_*.png`.
- Roadmap and PRD-to-spec map: `Docs/OVERVIEW.md`. Read this first to find the current feature and its spec.
- Per feature: `Docs/<Feature>/{Specs,Design,Decisions,Testing}/`. Specs follow the `spec-plan` skill.
- If work conflicts with the PRD, record it in the feature's `Decisions/` and add a revision note to the PRD. Never
  change requirements silently.

## Scope rules (from PRD §0)

- Only **Confirmed** items are binding. Do not turn Recommended items into scope, pull Deferred features
  (DOCX, XLSX, diff, AI, OCR, WYSIWYG, cloud) into MVP, or add dependencies that no decision record documents.
- Build one task (T-xxx) at a time, as a small independently testable change. Stop when its acceptance checks pass.

## Non-negotiables (release blockers, PRD §11.3)

- Never modify source documents on read, render or view toggle. Writes are atomic (temp file + rename), and a file
  changed on disk by something else is never silently overwritten.
- Exports are deterministic and preserve user comment text verbatim. Anchors fail closed: flag `ambiguous` or
  `orphaned`, never guess a target.
- No network access. Treat document and comment content as untrusted: sanitise rendered Markdown, validate manifests,
  block zip path traversal, keep the Tauri permission surface minimal, and run no arbitrary shell commands.
- Persisted data carries its own `schema_version`, separate from the app version. Migrations are explicit, tested and
  back up first.

## Layout and commands

Created by T-001 (feature `FoundationSpike`). Until it lands, treat this section as the contract, not the state.

```
src/            React + TypeScript UI          src-tauri/   Rust: commands, domain, export engine
schemas/        JSON Schema (generated)        fixtures/    shared test fixtures
```

- Web (repo root): `pnpm run check` (typecheck, lint, format:check, test) · `pnpm test` alone for tests · `pnpm run test:e2e` browser UI tests (Playwright, Rust faked)
- Rust (`src-tauri/`): `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test`
- App: `pnpm tauri dev` · `pnpm tauri build` (`--debug` for a debug bundle)

## Testing (applies to every task)

- New logic ships with tests in the same change: Vitest for TS, `cargo test` for Rust. Test real behaviour with
  realistic inputs plus edge and error paths, not mocks of the unit under test or snapshots of whatever it returns.
- Every test must fail if the behaviour it covers breaks. Risky areas (anchors, export, file writes, versioning,
  schema checks) are never merged untested.
- Run all lane checks before saying a task is done, and keep the whole suite green, not just the new tests. If a
  check was already failing, say so and don't hide it. Never delete, skip or loosen a test to go green.
- Shared fixtures live in `fixtures/`. A bug fix adds a fixture or test that fails without the fix.
- Tests run offline and never touch the user's real files. Use temp dirs.

## Conventions

- Rust owns persistence, versioning and the export engine; the UI talks to it through typed Tauri commands.
- A bug fix ships with a fixture or test that fails without it. Never delete or skip a test to go green.
- Branches: `feature/<T-id>-<slug>`. Commits are small and focused. Run lane checks before committing.
- SemVer for the app (`0.1.0` = first complete Markdown review loop). Tag at milestone acceptance.
