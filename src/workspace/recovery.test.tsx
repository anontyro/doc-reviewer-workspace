// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenedDocument, ProjectView } from "../api";
import type { DraftFile } from "../domain/generated/domain.schema";
import { fakeBackend } from "../review/fakeBackend";
import Workspace from "./Workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => {};
});

const plan: OpenedDocument = {
  path: "/p/plan.md",
  name: "plan.md",
  document_id: "doc_0123456789abcdef",
  version_id: "ver_0123456789abcdef",
  source_hash: "a".repeat(64),
  source: "# Plan\n",
  html: "<h1>Plan</h1>",
};
const project: ProjectView = {
  id: "proj_0123456789abcdef",
  name: "Alpha",
  root_path: "/p",
  documents: [{ relative_path: "plan.md", name: "plan.md" }],
};
const DISK = "d".repeat(64);
const draft = (over: Partial<DraftFile> = {}): DraftFile => ({
  schema_version: "1.0.0",
  document_id: "doc_0123456789abcdef",
  base_hash: "b".repeat(64),
  text: "# Plan\nfrom a crashed session\n",
  saved_at: "2026-11-20T10:00:00Z",
  ...over,
});

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;

async function mount(setup: (b: ReturnType<typeof fakeBackend>) => void = () => {}) {
  backend = fakeBackend(plan);
  backend.state.docs = { "plan.md": plan };
  setup(backend);
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
  vi.useRealTimers();
});

const button = (name: string) =>
  [...host.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name,
  ) as HTMLButtonElement;
const click = (name: string) => act(async () => button(name).click());
const called = (cmd: string) => backend.state.calls.filter((c) => c.cmd === cmd);
const view = () => EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
const type = (text: string) =>
  act(async () => view().dispatch({ changes: { from: view().state.doc.length, insert: text } }));
const focusWindow = () => act(async () => void window.dispatchEvent(new Event("focus")));
const saveKey = () =>
  act(async () => {
    host
      .querySelector(".cm-content")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
      );
  });
const dialog = (label: string) => host.querySelector(`[role="alertdialog"][aria-label="${label}"]`);
const changed = { status: "changed", disk_hash: DISK } as const;

const openClean = async () => {
  await click("plan.md");
};
const openDirty = async () => {
  await click("plan.md");
  await click("Source");
  await type("mine\n");
};

describe("a file that changes while a tab is clean", () => {
  it("shows a banner with Reload on focus, and reloads nothing until Reload is clicked", async () => {
    await mount();
    await openClean();
    const opens = called("open_project_document").length;
    backend.state.status = changed;
    await focusWindow();
    expect(called("check_document")).toHaveLength(1);
    expect(host.querySelector(".banner")!.textContent).toContain("changed on disk");
    expect(called("open_project_document")).toHaveLength(opens);

    backend.state.status = { status: "unchanged" };
    await click("Reload");
    expect(called("open_project_document")).toHaveLength(opens + 1);
    expect(host.querySelector(".banner")).toBeNull();
  });

  it("a file that is gone shows where it was and turns saving off", async () => {
    await mount();
    await openDirty();
    backend.state.status = { status: "missing" };
    await focusWindow();
    expect(host.querySelector(".banner")!.textContent).toContain("/p/plan.md");
    expect(button("Save").disabled).toBe(true);
    await saveKey();
    expect(called("save_document")).toHaveLength(0);
    expect(host.querySelector(".cm-content")!.textContent).toContain("mine"); // the text is kept
  });
});

describe("conflict dialog", () => {
  it("opens when a dirty tab's file changed, with Keep editing as the default that writes nothing", async () => {
    await mount();
    await openDirty();
    backend.state.status = changed;
    await focusWindow();
    expect(dialog("File changed on disk")).not.toBeNull();
    expect(document.activeElement).toBe(button("Keep editing"));
    await click("Keep editing");
    expect(dialog("File changed on disk")).toBeNull();
    for (const cmd of ["save_document", "backup_text", "clear_draft", "open_project_document"]) {
      expect(called(cmd).length, cmd).toBe(cmd === "open_project_document" ? 1 : 0);
    }
    // The same disk version does not ask again on every focus.
    await focusWindow();
    expect(dialog("File changed on disk")).toBeNull();
    expect(host.querySelector(".cm-content")!.textContent).toContain("mine");
  });

  it("opens when a save is refused because the file changed", async () => {
    await mount();
    await openDirty();
    backend.state.saveFails = {
      kind: "conflict",
      message: "the file changed on disk since it was opened",
    };
    await saveKey();
    expect(dialog("File changed on disk")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="tab"] [aria-label="unsaved changes"]')).not.toBeNull();
  });

  it("Load the disk version backs up the user's text first, then reloads and clears the draft", async () => {
    await mount();
    await openDirty();
    backend.state.status = changed;
    await focusWindow();
    const opens = called("open_project_document").length;
    await click("Load the disk version");
    const order = backend.state.calls.map((c) => c.cmd);
    expect(called("backup_text")[0].args).toEqual({ text: "# Plan\nmine\n" });
    expect(order.indexOf("backup_text")).toBeLessThan(order.lastIndexOf("open_project_document"));
    expect(called("open_project_document")).toHaveLength(opens + 1);
    expect(called("clear_draft")).toHaveLength(1);
    expect(called("save_document")).toHaveLength(0);
    expect(host.querySelector('[role="tab"] [aria-label="unsaved changes"]')).toBeNull();
    expect(dialog("File changed on disk")).toBeNull();
  });

  it("if the backup cannot be written the text stays and nothing is reloaded", async () => {
    await mount();
    await openDirty();
    backend.state.status = changed;
    await focusWindow();
    const base = backend.handler;
    mockIPC((cmd, args) => {
      if (cmd === "backup_text") throw { kind: "io", message: "could not write a backup" };
      return base(cmd, args);
    });
    const opens = called("open_project_document").length;
    await click("Load the disk version");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("could not write a backup");
    expect(called("open_project_document")).toHaveLength(opens);
    expect(host.querySelector(".cm-content")!.textContent).toContain("mine");
  });

  it("Overwrite needs a second confirmation, and only that saves, with the disk hash (AT-06)", async () => {
    await mount();
    await openDirty();
    backend.state.status = changed;
    await focusWindow();
    await click("Overwrite the disk version");
    expect(called("save_document")).toHaveLength(0); // one click is not enough
    expect(document.activeElement).toBe(button("Keep editing")); // and Keep editing is still the default

    await click("Keep editing"); // backing out at the second step writes nothing either
    expect(called("save_document")).toHaveLength(0);
    expect(dialog("File changed on disk")).toBeNull();

    // Ask again, and confirm this time.
    await saveKey(); // pre-save check sees the change and reopens the dialog, saving nothing
    expect(called("save_document")).toHaveLength(0);
    await click("Overwrite the disk version");
    await click("Yes, overwrite the disk version");
    expect(called("save_document")).toHaveLength(1);
    expect(called("save_document")[0].args).toEqual({
      text: "# Plan\nmine\n",
      expectedHash: DISK,
    });
  });

  it("the confirmed overwrite sends the new disk hash", async () => {
    await mount();
    await openDirty();
    backend.state.status = changed;
    await focusWindow();
    await click("Overwrite the disk version");
    await click("Yes, overwrite the disk version");
    expect(called("save_document")[0].args).toEqual({ text: "# Plan\nmine\n", expectedHash: DISK });
    expect(host.querySelector('[role="tab"] [aria-label="unsaved changes"]')).toBeNull();
    expect(called("clear_draft")).toHaveLength(1);
  });

  it("Escape in the dialog keeps editing", async () => {
    await mount();
    await openDirty();
    backend.state.status = changed;
    await focusWindow();
    await act(async () => {
      dialog("File changed on disk")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialog("File changed on disk")).toBeNull();
    expect(called("save_document")).toHaveLength(0);
  });
});

describe("drafts", () => {
  it("writes a draft two seconds after the last keystroke, and not before", async () => {
    vi.useFakeTimers();
    await mount();
    await openDirty();
    await act(async () => void vi.advanceTimersByTime(1999));
    expect(called("save_draft")).toHaveLength(0);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(called("save_draft")).toHaveLength(1);
    expect(called("save_draft")[0].args).toEqual({
      text: "# Plan\nmine\n",
      baseHash: plan.source_hash,
    });
  });

  it("each keystroke restarts the wait", async () => {
    vi.useFakeTimers();
    await mount();
    await openDirty();
    await act(async () => void vi.advanceTimersByTime(1500));
    await type("more");
    await act(async () => void vi.advanceTimersByTime(1500));
    expect(called("save_draft")).toHaveLength(0);
    await act(async () => void vi.advanceTimersByTime(500));
    expect(called("save_draft")).toHaveLength(1);
    expect(called("save_draft")[0].args).toMatchObject({ text: "# Plan\nmine\nmore" });
  });

  it("never writes a draft while the text is saved", async () => {
    vi.useFakeTimers();
    await mount();
    await click("plan.md");
    await click("Source");
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(called("save_draft")).toHaveLength(0);
    await type("x");
    await act(async () => void vi.advanceTimersByTime(500));
    act(() =>
      view().dispatch({
        changes: { from: view().state.doc.length - 1, to: view().state.doc.length },
      }),
    ); // back to saved
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(called("save_draft")).toHaveLength(0);
  });

  it("a successful save clears the draft", async () => {
    await mount();
    await openDirty();
    await saveKey();
    expect(called("save_document")).toHaveLength(1);
    expect(called("clear_draft")).toHaveLength(1);
  });

  it("discarding by closing the tab clears the draft", async () => {
    await mount();
    await openDirty();
    await click("Close plan.md");
    await click("Discard changes");
    expect(called("clear_draft")).toHaveLength(1);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });
});

describe("recovery", () => {
  it("offers Restore or Discard when a document with a draft is opened", async () => {
    await mount((b) => (b.state.draft = draft()));
    await openClean();
    expect(dialog("Unsaved text found")!.textContent).toContain("plan.md");
    expect(called("clear_draft")).toHaveLength(0); // nothing is thrown away until the user chooses
    expect(host.querySelector('[role="tab"] [aria-label="unsaved changes"]')).toBeNull();
  });

  it("Restore loads the draft as unsaved text based on the draft's hash", async () => {
    await mount((b) => (b.state.draft = draft()));
    await openClean();
    await click("Restore");
    expect(dialog("Unsaved text found")).toBeNull();
    expect(view().state.sliceDoc()).toBe("# Plan\nfrom a crashed session\n");
    expect(host.querySelector('[role="tab"] [aria-label="unsaved changes"]')).not.toBeNull();
    // Saving when the file has changed since the draft goes to the conflict dialog, not over the file.
    backend.state.saveFails = { kind: "conflict", message: "changed" };
    await saveKey();
    expect(called("save_document")[0].args).toEqual({
      text: "# Plan\nfrom a crashed session\n",
      expectedHash: "b".repeat(64),
    });
    expect(dialog("File changed on disk")).not.toBeNull();
  });

  it("Discard clears the draft and loads nothing", async () => {
    await mount((b) => (b.state.draft = draft()));
    await openClean();
    await click("Discard");
    expect(called("clear_draft")).toHaveLength(1);
    expect(dialog("Unsaved text found")).toBeNull();
    expect(host.querySelector('[role="tab"] [aria-label="unsaved changes"]')).toBeNull();
  });

  it("a draft equal to the file is cleared without asking", async () => {
    await mount((b) => (b.state.draft = draft({ text: plan.source })));
    await openClean();
    expect(dialog("Unsaved text found")).toBeNull();
    expect(called("clear_draft")).toHaveLength(1);
  });

  it("a draft that cannot be read is reported and the document still opens", async () => {
    await mount();
    const base = backend.handler;
    mockIPC((cmd, args) => {
      if (cmd === "read_draft")
        throw { kind: "io", message: "the draft is unusable: newer version" };
      return base(cmd, args);
    });
    await openClean();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("newer version");
    expect(host.querySelector("article h1")!.textContent).toBe("Plan");
    expect(called("clear_draft")).toHaveLength(0);
  });
});
