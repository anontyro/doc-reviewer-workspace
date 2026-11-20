// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenedDocument } from "../api";
import Reader from "../reader/Reader";
import { fakeBackend } from "./fakeBackend";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc: OpenedDocument = {
  path: "/tmp/a.md",
  name: "a.md",
  document_id: "doc_0123456789abcdef",
  version_id: "ver_0123456789abcdef",
  source_hash: "0".repeat(64),
  source: "",
  html: "<h1>Title</h1><p>Alpha beta gamma.</p>",
};

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;
let copied: string[];

async function mount() {
  backend = fakeBackend(doc);
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => void copied.push(t) },
  });
  mockIPC(backend.handler);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Reader />));
  await act(async () => host.querySelector("button")!.click()); // Open
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
});

const panel = () => host.querySelector(".export-panel")!;
const shown = () => (panel().querySelector("textarea") as HTMLTextAreaElement | null)?.value;
const click = (label: string) =>
  act(async () => {
    [...panel().querySelectorAll("button")].find((b) => b.textContent!.startsWith(label))!.click();
  });

describe("export panel", () => {
  it("is closed until asked for, and then shows the prompt Rust generates", async () => {
    await mount();
    expect(panel().querySelector("textarea")).toBeNull();
    await click("Export feedback");
    expect(shown()).toBe("# Review Instructions\n\n0 comment(s)\n");
  });

  it("copies exactly the text it shows, byte for byte", async () => {
    await mount();
    const awkward = "# Review\n\n````\n  spaces and `ticks` é😀\t\n````\n\n";
    backend.state.feedback = () => awkward;
    await click("Export feedback");
    expect(shown()).toBe(awkward);
    await click("Copy");
    expect(copied).toEqual([awkward]);
  });

  it("refreshes while open when a comment is added", async () => {
    await mount();
    await click("Export feedback");
    expect(shown()).toContain("0 comment(s)");

    const text = host.querySelector("article p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 10);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await act(async () => {
      host.querySelector("article")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "m", metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    const box = host.querySelector(".composer textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        box,
        "a comment",
      );
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });

    expect(shown()).toContain("1 comment(s)");
  });

  it("shows the error and disables Copy when no prompt can be generated", async () => {
    await mount();
    backend.state.failWith = { kind: "no_document", message: "no document is open" };
    await click("Export feedback");
    expect(panel().querySelector("[role=alert]")?.textContent).toBe("no document is open");
    expect((panel().querySelectorAll("button")[1] as HTMLButtonElement).disabled).toBe(true);
    await click("Copy");
    expect(copied).toEqual([]);
  });

  it("says so when the clipboard refuses", async () => {
    await mount();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    await click("Export feedback");
    await click("Copy");
    expect(panel().querySelector("[role=alert]")?.textContent).toContain("denied");
    expect(panel().querySelector("[role=status]")).toBeNull();
  });
});
