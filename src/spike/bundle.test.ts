import { build } from "vite";
import { expect, it } from "vitest";

// The spike view must never reach a production bundle (spec D18).
it("production bundle excludes the spike view and its fixtures", async () => {
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production"; // vitest sets "test", which makes Vite keep dev-only code
  const out = (await build({
    logLevel: "silent",
    mode: "production",
    build: { write: false },
  })) as {
    output: { type: string; code?: string }[];
  };
  process.env.NODE_ENV = env;
  const code = out.output.map((o) => o.code ?? "").join("\n");
  expect(code).toContain("LLM Review Workspace");
  expect(code).not.toMatch(/Source-map spike|spike_resolve_anchor|javascript:alert/);
}, 30_000);
