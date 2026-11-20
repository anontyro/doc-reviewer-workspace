// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenedDocument, ResolvedAnchor } from "../api";
import { fakeBackend } from "./fakeBackend";
import Reader from "../reader/Reader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc: OpenedDocument = {
  path: "/tmp/a.md",
  name: "a.md",
  document_id: "doc_0123456789abcdef",
  version_id: "ver_0123456789abcdef",
  source_hash: "0".repeat(64),
  source: "",
  html: "<h1>Title</h1><p>Alpha beta gamma.</p><p>Second paragraph.</p>",
};
const resolved: ResolvedAnchor = {
  confidence: "resolved",
  heading_path: ["Title"],
  source_range: { start: 9, end: 19 },
  candidates: 1,
};

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;
const answerWith = (r: ResolvedAnchor) => {
  backend.state.resolve = r;
};

async function mount() {
  backend = fakeBackend(doc);
  mockIPC(backend.handler);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Reader />));
  await act(async () => host.querySelector("button")!.click());
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  window.getSelection()?.removeAllRanges();
  clearMocks();
});

const article = () => host.querySelector("article")!;
const paragraph = (n: number) => article().querySelectorAll("p")[n].firstChild!;

/** Selects text in the document and fires the mouse-up the reader listens for. */
async function select(startNode: Node, start: number, endNode: Node, end: number) {
  const range = document.createRange();
  range.setStart(startNode, start);
  range.setEnd(endNode, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  await act(async () => {
    article().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}
const selectBeta = () => select(paragraph(0), 6, paragraph(0), 10);

const press = (key: string, opts: KeyboardEventInit = {}) =>
  act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }),
    );
  });
const shortcut = () => press("m", { metaKey: true, shiftKey: true });

/** Sets a React-controlled textarea's value the way typing does. */
async function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const textarea = () => host.querySelector("textarea") as HTMLTextAreaElement | null;
const menuButton = () => host.querySelector("[role=toolbar] button") as HTMLButtonElement | null;
const commentTexts = () => [...host.querySelectorAll(".comment-text")].map((e) => e.textContent);

describe("floating menu", () => {
  it("appears for a selection inside one block, with a Comment action", async () => {
    await mount();
    expect(menuButton()).toBeNull();
    await selectBeta();
    expect(menuButton()?.textContent).toBe("Comment");
  });

  it("does not appear for a collapsed selection or one across blocks", async () => {
    await mount();
    await select(paragraph(0), 3, paragraph(0), 3);
    expect(menuButton()).toBeNull();
    await select(paragraph(0), 3, paragraph(1), 4);
    expect(menuButton()).toBeNull();
  });

  it("opens the composer from the menu button and from Cmd+Shift+M", async () => {
    await mount();
    await selectBeta();
    await act(async () => menuButton()!.click());
    expect(textarea()).not.toBeNull();

    await press("Escape");
    expect(textarea()).toBeNull();
    await selectBeta();
    await shortcut();
    expect(textarea()).not.toBeNull();
  });
});

describe("composer", () => {
  it("saves on Cmd+Enter, shows the comment exactly as typed, and keeps the selection", async () => {
    await mount();
    await selectBeta();
    await shortcut();
    const typed = "  keep `these` spaces and ticks  \nsecond line ";
    await type(textarea()!, typed);
    await press("Enter", { metaKey: true });

    expect(textarea()).toBeNull();
    expect(commentTexts()).toEqual([typed]);
    expect(host.querySelector(".comment-quote")?.textContent).toBe("beta");
    expect(window.getSelection()?.toString()).toBe("beta");
    expect(document.activeElement).toBe(article());
  });

  it("Escape closes it, saves nothing, and puts focus and the selection back in the document", async () => {
    await mount();
    await selectBeta();
    await shortcut();
    await type(textarea()!, "draft");
    await press("Escape");

    expect(textarea()).toBeNull();
    expect(commentTexts()).toEqual([]);
    expect(window.getSelection()?.toString()).toBe("beta");
    expect(document.activeElement).toBe(article());
  });

  it("will not save empty or whitespace-only text", async () => {
    await mount();
    await selectBeta();
    await shortcut();
    await type(textarea()!, "   \n ");
    expect((host.querySelector(".composer button") as HTMLButtonElement).disabled).toBe(true);
    await press("Enter", { metaKey: true });
    expect(commentTexts()).toEqual([]);
    expect(textarea()).not.toBeNull();
  });

  it("refuses an ambiguous selection with a message and creates no comment", async () => {
    await mount();
    answerWith({ ...resolved, confidence: "ambiguous", source_range: null, candidates: 2 });
    await selectBeta();
    await shortcut();
    expect(textarea()).toBeNull();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("2 places");
    expect(commentTexts()).toEqual([]);
  });

  it("refuses an orphaned selection with a message", async () => {
    await mount();
    answerWith({
      ...resolved,
      confidence: "orphaned",
      source_range: null,
      candidates: 0,
      heading_path: null,
    });
    await selectBeta();
    await shortcut();
    expect(textarea()).toBeNull();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("not found");
  });

  it("says a selection across blocks is not supported, and creates nothing", async () => {
    await mount();
    await select(paragraph(0), 3, paragraph(1), 4);
    await shortcut();
    expect(textarea()).toBeNull();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Not supported");
    expect(commentTexts()).toEqual([]);
  });
});

describe("comment panel", () => {
  it("jumps to a comment's passage: selects it and focuses the document", async () => {
    await mount();
    await selectBeta();
    await shortcut();
    await type(textarea()!, "first");
    await press("Enter", { metaKey: true });
    window.getSelection()!.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur();

    await act(async () => (host.querySelector(".comment-jump") as HTMLButtonElement).click());
    expect(window.getSelection()?.toString()).toBe("beta");
    expect(document.activeElement).toBe(article());
  });

  it("drops the previous document's comments when another document is opened", async () => {
    await mount();
    await selectBeta();
    await shortcut();
    await type(textarea()!, "first");
    await press("Enter", { metaKey: true });
    expect(commentTexts()).toHaveLength(1);
    backend.state.failWith = { kind: "io", message: "cannot read the comments file" };
    await act(async () => host.querySelector("button")!.click()); // Open another document
    // Its comments cannot be loaded, so the panel must not still show the previous document's.
    expect(commentTexts()).toEqual([]);
    expect(host.querySelector("aside [role=alert]")?.textContent).toContain("cannot read");
  });
});
