// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { ERROR_KINDS, type OpenedDocument } from "./api";
import { fakeBackend } from "./review/fakeBackend";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement;

async function mount(setup: (b: ReturnType<typeof fakeBackend>) => void = () => {}) {
  const backend = fakeBackend({ name: "a.md" } as OpenedDocument);
  setup(backend);
  mockIPC(backend.handler);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  return backend;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
});

const click = (name: string) =>
  act(async () =>
    (
      [...host.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLElement
    ).click(),
  );

describe("App", () => {
  it("starts on the home screen under the app heading", async () => {
    await mount();
    expect(host.querySelector("h1")!.textContent).toBe("LLM Review Workspace");
    expect(host.querySelector("h2")!.textContent).toBe("Projects");
    expect(document.title).toBe("LLM Review Workspace");
  });

  it("opening a project shows it, sets the window title and moves focus to its heading", async () => {
    await mount((b) => {
      b.state.pick = {
        id: "proj_0123456789abcdef",
        name: "Alpha",
        root_path: "/Users/me/Alpha",
        documents: [{ relative_path: "plan.md", name: "plan.md" }],
      };
    });
    await click("Open folder");
    expect(host.querySelector("h2")!.textContent).toBe("Alpha");
    expect(host.textContent).toContain("plan.md");
    expect(document.title).toBe("Alpha · LLM Review Workspace");
    expect(document.activeElement).toBe(host.querySelector("h2"));

    await click("Back to projects");
    expect(host.querySelector("h2")!.textContent).toBe("Projects");
  });

  it("Quick open shows the reader, and Back returns home", async () => {
    await mount();
    await click("Quick open");
    expect(host.textContent).toContain("Open Markdown file");
    expect(document.title).toBe("Quick open · LLM Review Workspace");
    await click("Back to projects");
    expect(host.querySelector("h2")!.textContent).toBe("Projects");
  });
});

describe("api", () => {
  it("ERROR_KINDS equals the ErrorKind enum in Rust", () => {
    const rust = readFileSync("src-tauri/src/document.rs", "utf8"); // vitest runs from the repo root;
    const body = /pub enum ErrorKind \{([\s\S]*?)\n\}/.exec(rust)![1];
    const variants = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[A-Z][A-Za-z0-9]*,$/.test(l))
      .map((l) =>
        l
          .slice(0, -1)
          .replace(/(?<!^)([A-Z])/g, "_$1")
          .toLowerCase(),
      );
    expect(variants.length).toBeGreaterThan(0);
    expect([...ERROR_KINDS].sort()).toEqual([...variants].sort());
  });
});
