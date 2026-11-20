// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenedDocument, ProjectView } from "../api";
import { fakeBackend } from "../review/fakeBackend";
import Workspace from "../workspace/Workspace";
import SourceEditor from "./SourceEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout. CodeMirror measures text with these.
beforeAll(() => {
  const rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => {};
});

const make = (name: string, source: string): OpenedDocument => ({
  path: `/p/${name}`,
  name,
  document_id: "doc_0123456789abcdef",
  version_id: "ver_0123456789abcdef",
  source_hash: "a".repeat(64),
  source,
  html: "<h1>Plan</h1><p>Alpha beta.</p>",
});
const plan = make("plan.md", "# Plan\n\nAlpha beta.\n");
const project: ProjectView = {
  id: "proj_0123456789abcdef",
  name: "Alpha",
  root_path: "/p",
  documents: [
    { relative_path: "plan.md", name: "plan.md" },
    { relative_path: "notes.md", name: "notes.md" },
  ],
};

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;

async function mount(doc = plan) {
  backend = fakeBackend(doc);
  backend.state.docs = { "plan.md": doc, "notes.md": make("notes.md", "# Notes\n") };
  mockIPC(backend.handler);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Workspace project={project} onHome={() => {}} />));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
  window.getSelection()?.removeAllRanges();
});

const button = (name: string) =>
  [...host.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name,
  )!;
const click = (name: string) => act(async () => button(name).click());
const called = (cmd: string) => backend.state.calls.filter((c) => c.cmd === cmd);
const view = () => EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
const edit = (changes: { from: number; to?: number; insert?: string }) =>
  act(async () => view().dispatch({ changes }));
const press = (init: KeyboardEventInit) =>
  act(async () => {
    host
      .querySelector(".cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
const openSource = async () => {
  await click("plan.md");
  await click("Source");
};
const dirtyMarker = () => host.querySelector('[role="tab"] [aria-label="unsaved changes"]');

describe("toggle", () => {
  it("switching many times makes no save and no other write (AT-02)", async () => {
    await mount();
    await click("plan.md");
    for (let i = 0; i < 6; i++) {
      await click("Source");
      await click("Rendered");
    }
    const writes = [
      "save_document",
      "create_annotation",
      "update_annotation",
      "delete_annotation",
      "add_document",
      "save_draft",
    ];
    expect(backend.state.calls.filter((c) => writes.includes(c.cmd))).toEqual([]);
  });

  it("source shows the file's text and rendered shows the rendered html", async () => {
    await mount();
    await openSource();
    expect(view().state.sliceDoc()).toBe(plan.source);
    await click("Rendered");
    expect(host.querySelector("article h1")!.textContent).toBe("Plan");
  });
});

describe("save", () => {
  it("typing marks the tab unsaved, and Cmd+S saves the text with the hash it was loaded from", async () => {
    await mount();
    await openSource();
    expect(dirtyMarker()).toBeNull();
    await edit({ from: 0, insert: "NEW " });
    expect(dirtyMarker()).not.toBeNull();

    await press({ key: "s", ctrlKey: true });
    expect(called("save_document")[0].args).toEqual({
      text: "NEW # Plan\n\nAlpha beta.\n",
      expectedHash: plan.source_hash,
    });
    expect(dirtyMarker()).toBeNull();
    await click("Rendered");
    expect(host.querySelector("article")!.textContent).toBe("NEW # Plan\n\nAlpha beta.\n");
  });

  it("a save error is shown and the text and unsaved marker stay", async () => {
    await mount();
    await openSource();
    await edit({ from: 0, insert: "mine " });
    backend.state.saveFails = {
      kind: "conflict",
      message: "the file changed on disk since it was opened",
    };
    await press({ key: "s", ctrlKey: true });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("changed on disk");
    expect(dirtyMarker()).not.toBeNull();
    expect(view().state.sliceDoc()).toBe("mine # Plan\n\nAlpha beta.\n");
  });

  it("Save is off until there is something to save", async () => {
    await mount();
    await openSource();
    expect((button("Save") as HTMLButtonElement).disabled).toBe(true);
    await edit({ from: 0, insert: "x" });
    expect((button("Save") as HTMLButtonElement).disabled).toBe(false);
    await edit({ from: 0, to: 1, insert: "" }); // back to the saved text
    expect(dirtyMarker()).toBeNull();
  });

  it("unsaved text stays with its tab when another tab is shown and back", async () => {
    await mount();
    await openSource();
    await edit({ from: 0, insert: "kept " });
    await click("notes.md");
    expect(host.querySelector("article h1")?.textContent ?? "").not.toBe("kept");
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) =>
      t.textContent!.startsWith("plan.md"),
    )!;
    await act(async () => (tab as HTMLElement).click());
    await click("Source");
    expect(view().state.sliceDoc()).toBe("kept # Plan\n\nAlpha beta.\n");
  });
});

describe("line endings", () => {
  const roundTrip = async (source: string) => {
    const seen: string[] = [];
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const r = createRoot(host2);
    await act(async () =>
      r.render(<SourceEditor initial={source} onChange={(t) => seen.push(t)} onSave={() => {}} />),
    );
    const v = EditorView.findFromDOM(host2.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(v.state.sliceDoc()).toBe(source); // opened exactly
    await act(async () => v.dispatch({ changes: { from: v.state.doc.length, insert: "X" } }));
    await act(async () =>
      v.dispatch({ changes: { from: v.state.doc.length - 1, to: v.state.doc.length } }),
    );
    act(() => r.unmount());
    host2.remove();
    return seen;
  };

  it.each([
    ["LF", "# A\n\ntext\n"],
    ["CRLF", "# A\r\n\r\ntext\r\n"],
    ["no trailing newline", "# A\n\ntext"],
    ["CRLF with no trailing newline", "# A\r\n\r\ntext"],
  ])("%s: an edit and its undo give back the original text", async (_n, source) => {
    const seen = await roundTrip(source);
    expect(seen).toEqual([source + "X", source]);
  });

  it("CRLF stays CRLF when a new line is typed", async () => {
    const seen: string[] = [];
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const r = createRoot(host2);
    await act(async () =>
      r.render(
        <SourceEditor initial={"a\r\nb"} onChange={(t) => seen.push(t)} onSave={() => {}} />,
      ),
    );
    const v = EditorView.findFromDOM(host2.querySelector<HTMLElement>(".cm-editor")!)!;
    await act(async () => v.dispatch({ changes: { from: 1, insert: v.state.lineBreak } }));
    expect(seen).toEqual(["a\r\n\r\nb"]);
    act(() => r.unmount());
    host2.remove();
  });

  it.each([
    ["mixed endings", "a\r\nb\nc\n"],
    ["a lone CR", "a\rb\n"],
  ])("%s opens read-only with the reason and no save", async (_n, source) => {
    await mount(make("plan.md", source));
    await openSource();
    expect(host.querySelector('[role="note"]')!.textContent).toContain("read-only");
    expect(view().state.readOnly).toBe(true);
    expect(host.querySelector(".cm-content")!.getAttribute("contenteditable")).toBe("false");
    expect((button("Save") as HTMLButtonElement).disabled).toBe(true);
    await press({ key: "s", ctrlKey: true });
    expect(called("save_document")).toHaveLength(0);
  });
});

describe("editor commands", () => {
  const select = (from: number, to: number) =>
    act(async () => view().dispatch({ selection: { anchor: from, head: to } }));

  it("Cmd+B and Cmd+I wrap the selection", async () => {
    await mount();
    await openSource();
    await select(2, 6); // "Plan"
    await press({ key: "b", ctrlKey: true });
    expect(view().state.sliceDoc()).toBe("# **Plan**\n\nAlpha beta.\n");
    await select(12, 17); // "Alpha"
    await press({ key: "i", ctrlKey: true });
    expect(view().state.sliceDoc()).toBe("# **Plan**\n\n*Alpha* beta.\n");
  });

  it("Cmd+B with nothing selected inserts a pair and puts the cursor between", async () => {
    await mount(make("plan.md", ""));
    await openSource();
    await press({ key: "b", ctrlKey: true });
    expect(view().state.sliceDoc()).toBe("****");
    expect(view().state.selection.main.head).toBe(2);
  });

  it("Cmd+F opens find", async () => {
    await mount();
    await openSource();
    expect(host.querySelector(".cm-search")).toBeNull();
    await act(async () => view().focus());
    await press({ key: "f", ctrlKey: true });
    expect(host.querySelector(".cm-search")).not.toBeNull();
  });

  it("undo and redo work", async () => {
    await mount();
    await openSource();
    await edit({ from: 0, insert: "typed " });
    await press({ key: "z", ctrlKey: true });
    expect(view().state.sliceDoc()).toBe(plan.source);
    await press({ key: "y", ctrlKey: true });
    expect(view().state.sliceDoc()).toBe("typed " + plan.source);
  });
});

describe("unsaved edits", () => {
  it("rendered view of an unsaved tab shows the banner and a disabled Comment", async () => {
    await mount();
    await openSource();
    await edit({ from: 0, insert: "x" });
    await click("Rendered");
    expect(host.querySelector(".banner")!.textContent).toContain("last saved text");
    const p = host.querySelector("article p")!.firstChild!;
    const range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(p, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await act(async () => {
      host.querySelector("article")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const status = host.querySelector('.floating[role="status"]')!;
    expect(status.textContent).toContain("Save first");
    expect((status.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("closing an unsaved tab asks first, and Keep editing leaves it open and unchanged", async () => {
    await mount();
    await openSource();
    await edit({ from: 0, insert: "mine " });
    await click("Close plan.md");
    expect(host.querySelector('[role="alertdialog"]')!.textContent).toContain("plan.md");
    expect(document.activeElement).toBe(button("Keep editing"));
    await click("Keep editing");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(view().state.sliceDoc()).toBe("mine # Plan\n\nAlpha beta.\n");

    await click("Close plan.md");
    await click("Discard changes");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("a tab with no unsaved text closes without asking", async () => {
    await mount();
    await openSource();
    await click("Close plan.md");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("leaving the project with unsaved text asks first", async () => {
    const onHome = vi.fn();
    backend = fakeBackend(plan);
    backend.state.docs = { "plan.md": plan };
    mockIPC(backend.handler);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Workspace project={project} onHome={onHome} />));
    await openSource();
    await edit({ from: 0, insert: "x" });
    await click("Back to projects");
    expect(onHome).not.toHaveBeenCalled();
    await click("Keep editing");
    await click("Back to projects");
    await click("Discard changes");
    expect(onHome).toHaveBeenCalledOnce();
  });
});
