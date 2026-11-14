# 0001 · The web shell sits at the repo root, Rust in `src-tauri/`, and one fixed set of check commands covers both

**Status:** Agreed · **Work items:** T-001 · **Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` D1–D5

The app is a Vite + React + TypeScript web shell at the repo root and a Tauri 2 Rust crate in `src-tauri/`. pnpm is the
package manager. Every task runs the same commands, and the shell makes no network calls.

- **Layout.** `src/` (UI), `src-tauri/` (Rust), `schemas/` (generated JSON Schema) and `fixtures/` (shared test data).
  There is no Rust workspace and no monorepo tooling.
- **Check commands.** Web: `pnpm run check` runs `typecheck` (`tsc --noEmit`), `lint` (ESLint), `format:check`
  (Prettier) and `test` (Vitest). Rust, from `src-tauri/`: `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings`, `cargo test`. A debug bundle is `pnpm tauri build --debug`.
- **Permissions.** The only capability is `core:default` on the `main` window. No `shell`, `http` or `fs` plugin is
  installed. Later features add narrowly scoped permissions in their own specs.
- **Offline.** No runtime fetch of fonts, scripts or styles. The content security policy is `default-src 'self'`.
- **Dev port.** Vite runs on 1420 with `strictPort`, and `tauri.conf.json` `devUrl` points at it.
- **Dependencies added in R1.** Runtime: `react`, `react-dom`, Rust `tauri` 2 and `tauri-build` 2. Dev: `vite`,
  `@vitejs/plugin-react`, `vitest`, `typescript` (6.x), `eslint` with `@eslint/js`, `typescript-eslint` and
  `eslint-plugin-react-hooks`, `globals`, `prettier`, `@tauri-apps/cli`, and the `@types/*` packages.
- **Toolchain.** Rust stable at least 1.100 (older versions cannot build Tauri 2's dependencies) and Node 24.

## Why

One fixed command set lets every builder and reviewer run the same checks. pnpm was chosen over npm by the owner.
TypeScript is held at 6.x because `typescript-eslint` does not yet support 7. Tauri 2 stable is used, not the Tauri 3
alpha, because the PRD confirms Tauri 2.

## Consequences

- The TypeScript pin must be revisited when `typescript-eslint` supports 7.
- A machine with an older Rust toolchain cannot build the app until it runs `rustup update stable`.
- Icons are a flat placeholder generated with `tauri icon`. Real branding is out of scope.
