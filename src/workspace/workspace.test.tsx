// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedDocument, ProjectView } from "../api";
import { fakeBackend } from "../review/fakeBackend";
import Workspace from "./Workspace";
import { neighbour } from "./useTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const make = (name: string, html: string): OpenedDocument => ({
  path: `/p/${name}`,
  name,
  document_id: "doc_0123456789abcdef",
  version_id: "ver_0123456789abcdef",
  source_hash: "0".repeat(64),
  source: "",
  html,
});
const plan = make("plan.md", "<h1>Plan</h1><p>Alpha beta.</p>");
const notes = make("notes.md", "<h1>Notes</h1><p>Gamma.</p>");
const project: ProjectView = {
  id: "proj_0123456789abcdef",
  name: "Alpha",
  root_path: "/p",
  documents: [
    { relative_path: "plan.md", name: "plan.md" },
    { relative_path: "notes.md", name: "notes.md" },
    { relative_path: ".plan.md.tmp-123", name: ".plan.md.tmp-123" },
  ],
};

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;
const onHome = vi.fn();

async function mount(props: Partial<Parameters<typeof Workspace>[0]> = { project }) {
  backend = fakeBackend(plan);
  backend.state.docs = { "plan.md": plan, "notes.md": notes };
  mockIPC(backend.handler);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(<Workspace onHome={onHome} {...(props as { project: ProjectView })} />),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
  vi.clearAllMocks();
});

const named = (sel: string, name: string) =>
  [...host.querySelectorAll<HTMLElement>(sel)].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name,
  )!;
const explorer = (name: string) => named("nav button", name);
const click = (el: HTMLElement) => act(async () => el.click());
const called = (cmd: string) => backend.state.calls.filter((c) => c.cmd === cmd);
const key = (init: KeyboardEventInit, target: EventTarget = window) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
const tabs = () => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
const selected = () =>
  host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null;

describe("neighbour", () => {
  it("prefers the tab on the right, then the left, then none", () => {
    expect(neighbour(["a", "b", "c"], "b")).toBe("c");
    expect(neighbour(["a", "b", "c"], "c")).toBe("b");
    expect(neighbour(["a"], "a")).toBeNull();
  });
});

describe("Workspace explorer", () => {
  it("lists the documents and never a dot-file or temp file", async () => {
    await mount();
    expect([...host.querySelectorAll("nav li")].map((li) => li.textContent)).toEqual([
      "plan.md",
      "notes.md",
    ]);
  });

  it("Add document shows the new document", async () => {
    await mount();
    backend.state.pick = {
      ...project,
      documents: [...project.documents, { relative_path: "new.md", name: "new.md" }],
    };
    await click(named("button", "Add document"));
    expect(explorer("new.md")).toBeTruthy();
  });

  it("a refused add shows the message and leaves the list unchanged", async () => {
    await mount();
    mockIPC((cmd) => {
      if (cmd === "add_document")
        throw { kind: "exists", message: "new.md already exists, rename the source file first" };
      return null;
    });
    await click(named("button", "Add document"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("already exists");
    expect([...host.querySelectorAll("nav li")]).toHaveLength(2);
  });

  it("a cancelled add changes nothing", async () => {
    await mount();
    backend.state.pick = null;
    await click(named("button", "Add document"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect([...host.querySelectorAll("nav li")]).toHaveLength(2);
  });
});

describe("Workspace tabs", () => {
  it("starts empty and opens a document in a tab through open_project_document", async () => {
    await mount();
    expect(host.textContent).toContain("Select a document to open it.");
    await click(explorer("plan.md"));
    expect(called("open_project_document")[0].args).toEqual({ relativePath: "plan.md" });
    expect(tabs()).toEqual(["plan.md"]);
    expect(host.querySelector("article h1")!.textContent).toBe("Plan");
  });

  it("selecting an open tab asks Rust for the file again and reloads its comments", async () => {
    await mount();
    await click(explorer("plan.md"));
    await click(explorer("notes.md"));
    const lists = called("list_annotations").length;
    await click(named('[role="tab"]', "plan.md"));
    expect(called("open_project_document").map((c) => c.args)).toEqual([
      { relativePath: "plan.md" },
      { relativePath: "notes.md" },
      { relativePath: "plan.md" },
    ]);
    expect(called("list_annotations").length).toBeGreaterThan(lists);
    expect(tabs()).toEqual(["plan.md", "notes.md"]); // no duplicate tab
    expect(selected()).toBe("plan.md");
  });

  it("is a tablist, only the selected tab is in the tab order, and arrows move focus", async () => {
    await mount();
    await click(explorer("plan.md"));
    await click(explorer("notes.md"));
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    const [planTab, notesTab] = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect([planTab.tabIndex, notesTab.tabIndex]).toEqual([-1, 0]);
    notesTab.focus();
    await key({ key: "ArrowLeft" }, notesTab);
    expect(document.activeElement).toBe(planTab);
    await key({ key: "ArrowRight" }, planTab);
    expect(document.activeElement).toBe(notesTab);
    await key({ key: "ArrowRight" }, notesTab); // wraps
    expect(document.activeElement).toBe(planTab);
  });

  it("closing the active tab shows its neighbour, and closing the last shows the empty state", async () => {
    await mount();
    await click(explorer("plan.md"));
    await click(explorer("notes.md"));
    await click(named("button", "Close notes.md"));
    expect(tabs()).toEqual(["plan.md"]);
    expect(selected()).toBe("plan.md");
    expect(host.querySelector("article h1")!.textContent).toBe("Plan");
    await click(named("button", "Close plan.md"));
    expect(tabs()).toEqual([]);
    expect(host.querySelector("article")).toBeNull();
    expect(host.textContent).toContain("Select a document to open it.");
  });

  it("closing a background tab leaves the active document alone", async () => {
    await mount();
    await click(explorer("plan.md"));
    await click(explorer("notes.md"));
    const opens = called("open_project_document").length;
    await click(named("button", "Close plan.md"));
    expect(called("open_project_document")).toHaveLength(opens);
    expect(selected()).toBe("notes.md");
  });

  it("a document that cannot be opened shows the error and adds no tab", async () => {
    await mount();
    mockIPC(() => {
      throw { kind: "missing", message: "plan.md is no longer where it was" };
    });
    await click(explorer("plan.md"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("no longer where");
    expect(tabs()).toEqual([]);
  });

  it("shows the answer of the last click when an earlier one arrives late", async () => {
    await mount();
    let release!: (d: OpenedDocument) => void;
    mockIPC((cmd, args) => {
      if (cmd === "open_project_document")
        return (args as { relativePath: string }).relativePath === "plan.md"
          ? new Promise<OpenedDocument>((r) => (release = r))
          : notes;
      return cmd === "list_annotations" ? [] : null;
    });
    await click(explorer("plan.md")); // slow
    await click(explorer("notes.md")); // fast
    await act(async () => release(plan));
    expect(host.querySelector("article h1")!.textContent).toBe("Notes");
    expect(tabs()).toEqual(["notes.md"]);
  });
});

describe("Workspace comments", () => {
  it("shows one document's comments only while that document is active", async () => {
    await mount();
    await click(explorer("plan.md"));
    backend.handler("create_annotation", {
      selected: "Alpha",
      prefix: "",
      suffix: " beta.",
      text: "plan comment",
    });
    await click(named('[role="tab"]', "plan.md")); // reactivating loads the comment Rust holds
    expect(host.textContent).toContain("plan comment");
    await click(explorer("notes.md")); // Rust now has notes.md and no comments for it
    expect(host.textContent).not.toContain("plan comment");
    await click(named('[role="tab"]', "plan.md"));
    expect(host.textContent).toContain("plan comment");
  });
});

describe("Workspace sidebars", () => {
  const hidden = (label: string) =>
    host.querySelector<HTMLElement>(`aside[aria-label="${label}"]`)!.hidden;

  it("collapse and expand by button, keeping the same article element", async () => {
    await mount();
    await click(explorer("plan.md"));
    const article = host.querySelector("article");
    await click(named("button", "Hide documents"));
    expect(hidden("Project documents")).toBe(true);
    await click(named("button", "Hide review panel"));
    expect(hidden("Comments and export")).toBe(true);
    expect(host.querySelector("article")).toBe(article); // not remounted, so scroll position stays
    await click(named("button", "Show documents"));
    expect(hidden("Project documents")).toBe(false);
  });

  it("collapse by Cmd+Backslash and Cmd+Shift+Backslash", async () => {
    await mount();
    await key({ code: "Backslash", metaKey: true });
    expect(hidden("Project documents")).toBe(true);
    expect(hidden("Comments and export")).toBe(false);
    await key({ code: "Backslash", metaKey: true, shiftKey: true });
    expect(hidden("Comments and export")).toBe(true);
    await key({ code: "Backslash" }); // without Cmd: ignored
    expect(hidden("Project documents")).toBe(true);
  });

  it("the comment panel lives in the right sidebar", async () => {
    await mount();
    await click(explorer("plan.md"));
    expect(
      host.querySelector('aside[aria-label="Comments and export"] .export-panel'),
    ).not.toBeNull();
  });
});

describe("Workspace in Quick Open", () => {
  it("shows one document with no explorer or tabs, labelled as not in a project", async () => {
    await mount({ quickDoc: plan });
    expect(host.querySelector("nav")).toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).toContain("Not in a project");
    expect(host.querySelector("article h1")!.textContent).toBe("Plan");
  });
});
