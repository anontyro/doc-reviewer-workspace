import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Port must match src-tauri/tauri.conf.json devUrl.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: { include: ["src/**/*.test.{ts,tsx}", "fixtures/**/*.test.ts"] },
});
