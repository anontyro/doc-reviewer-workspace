# 0005 · A small Playwright suite runs the web UI in a real browser engine with the Rust side faked

**Status:** Agreed · **Work items:** T-005 follow-up · **Added after:** F2 completion (not in the F2 spec)

- **What it is.** `@playwright/test` is a dev dependency only. `pnpm run test:e2e` starts the Vite dev server and runs
  `e2e/*.spec.ts` in Chromium and WebKit. `e2e/fakeTauri.ts` replaces the Tauri bridge in the page with a small stand-in
  that resolves a quote by counting it with its context, so ambiguous and orphaned cases behave like the real thing.
- **What it covers.** Real selection, focus, menu placement, keyboard shortcuts, highlight painting and link
  inertness, which jsdom cannot show. It does not run the Rust commands, the native dialog or the macOS WKWebView.
  Those stay in `cargo test` and the manual checklist.
- **Why not drive the real app.** Tauri's WebDriver has no macOS driver, so the packaged app cannot be automated this way.
- **Not part of `pnpm run check`.** It needs browser downloads and a dev server, so it is run on demand and
  before a PR. Adding it to CI is a later decision.
- **Honest limit.** A passing run proves the UI logic in two engines, not that the real app works. A fake that drifts
  from the Rust contract would hide a bug, so the fake must change whenever a command's shape does.
