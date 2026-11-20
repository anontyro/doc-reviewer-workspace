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

async function mount(d: OpenedDocument = doc) {
  mockIPC((cmd) => (cmd === "list_annotations" ? [] : null));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Reader doc={d} />));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
});

describe("Reader", () => {
  it("shows the rendered html of the document it is given", async () => {
    await mount();
    expect(host.querySelector("article h1")?.textContent).toBe("Rendered title");
  });

  it("injects the rendered html, never the source text", async () => {
    await mount();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).not.toContain("__pwned");
  });

  it("has no Open button: opening belongs to the home screen and the explorer", async () => {
    await mount();
    expect(host.textContent).not.toContain("Open Markdown");
  });

  it("never lets a link in the document navigate the app window", async () => {
    await mount({
      ...doc,
      html: '<p><a href="https://example.com/a">remote</a> <a href="other.md">relative</a> <a href="">empty</a></p>',
    });
    for (const a of host.querySelectorAll("article a")) {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      a.dispatchEvent(click);
      expect(click.defaultPrevented, a.textContent ?? "").toBe(true);
    }
    const outside = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("article")!.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false); // other clicks are left alone
  });
});
