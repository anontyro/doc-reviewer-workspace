// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenedDocument } from "../api";
import Reader from "./Reader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc: OpenedDocument = {
  path: "/tmp/a.md",
  name: "a.md",
  document_id: "doc_0123456789abcdef",
  version_id: "ver_0123456789abcdef",
  source_hash: "0".repeat(64),
  source: "<script>window.__pwned = 1</script>",
  html: '<h1 data-sourcepos="1:1-1:7">Rendered title</h1>',
};

let root: Root | undefined;
let host: HTMLElement;

async function mount(handler: (cmd: string) => unknown) {
  mockIPC((cmd) => (cmd === "list_annotations" ? [] : handler(cmd)));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Reader />));
}

const clickOpen = () =>
  act(async () => {
    host.querySelector("button")!.click();
  });

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
});

describe("Reader", () => {
  it("shows the rendered html after a file is opened", async () => {
    await mount(() => doc);
    await clickOpen();
    expect(host.querySelector("article h1")?.textContent).toBe("Rendered title");
    expect(host.textContent).toContain("a.md");
  });

  it("injects the rendered html, never the source text", async () => {
    await mount(() => doc);
    await clickOpen();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).not.toContain("__pwned");
  });

  it("keeps what is open when the dialog is cancelled, with no error", async () => {
    const answers: unknown[] = [doc, null];
    await mount(() => answers.shift());
    await clickOpen();
    await clickOpen();
    expect(host.querySelector("article h1")).not.toBeNull();
    expect(host.querySelector("[role=alert]")).toBeNull();
  });

  it("shows nothing before a file is opened", async () => {
    await mount(() => null);
    await clickOpen();
    expect(host.querySelector("article")).toBeNull();
    expect(host.querySelector("[role=alert]")).toBeNull();
  });

  it("shows a refused file's message and keeps the reader as it was", async () => {
    let call = 0;
    await mount(() => {
      if (call++ === 0) return doc;
      throw { kind: "not_utf8", message: "file is not UTF-8 text" };
    });
    await clickOpen();
    await clickOpen();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("file is not UTF-8 text");
    expect(host.querySelector("article h1")).not.toBeNull();
  });
});
