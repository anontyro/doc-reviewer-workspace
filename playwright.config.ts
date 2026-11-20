import { defineConfig, devices } from "@playwright/test";

// Runs the web UI in a real browser engine with the Rust side faked (e2e/fakeTauri.ts).
// It cannot show the real macOS WKWebView or the Rust commands: those stay in the manual checklist.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:1420" },
  webServer: { command: "pnpm run dev", url: "http://localhost:1420", reuseExistingServer: true },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
});
