// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem, OpenedDocument, ProjectView } from "../api";
import { fakeBackend } from "../review/fakeBackend";
import Home from "./Home";
import { timeAgo } from "./useLibrary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc = { name: "a.md" } as OpenedDocument;
const item = (id: string, name: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  project_id: id,
  name,
  root_path: `/Users/me/${name}`,
  last_opened_at: "2026-11-20T10:00:00Z",
  missing: false,
  ...over,
});
const project: ProjectView = {
  id: "proj_0123456789abcdef",
  name: "Alpha",
  root_path: "/Users/me/Alpha",
  documents: [],
};

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;
const onOpenProject = vi.fn();
const onQuickOpen = vi.fn();

async function mount(setup: (b: ReturnType<typeof fakeBackend>) => void = () => {}) {
  backend = fakeBackend(doc);
  setup(backend);
  mockIPC(backend.handler);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(<Home onOpenProject={onOpenProject} onQuickOpen={onQuickOpen} />),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  clearMocks();
  vi.clearAllMocks();
});

const button = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name,
  ) as HTMLButtonElement;
const click = (name: string) => act(async () => button(name).click());
const called = (cmd: string) => backend.state.calls.filter((c) => c.cmd === cmd);
const setValue = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = (form: HTMLFormElement) =>
  act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("Home", () => {
  it("lists projects in the order Rust returns, with the path and a missing badge", async () => {
    await mount((b) => {
      b.state.library = [item("proj_b", "Beta"), item("proj_a", "Alpha", { missing: true })];
    });
    const cards = [...host.querySelectorAll(".project-card")];
    expect(cards.map((c) => c.querySelector("h3")!.firstChild!.textContent)).toEqual([
      "Beta",
      "Alpha",
    ]);
    expect(cards[0].textContent).toContain("/Users/me/Beta");
    expect(cards[0].textContent).not.toContain("Folder missing");
    expect(cards[1].textContent).toContain("Folder missing");
  });

  it("says there are no projects when the library is empty", async () => {
    await mount();
    expect(host.textContent).toContain("No projects yet");
  });

  it("opens a library entry through open_project_at", async () => {
    await mount((b) => {
      b.state.library = [item("proj_a", "Alpha")];
    });
    await click("Open Alpha");
    expect(called("open_project_at")[0].args).toEqual({ projectId: "proj_a" });
    expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: "proj_a" }));
  });

  it("a cancelled folder dialog changes nothing and shows no error", async () => {
    await mount((b) => {
      b.state.pick = null;
    });
    await click("Open folder");
    expect(called("open_project")).toHaveLength(1);
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("opens the picked project from Open folder", async () => {
    await mount((b) => {
      b.state.pick = project;
    });
    await click("Open folder");
    expect(onOpenProject).toHaveBeenCalledWith(project);
  });

  it("New project asks for a name, then sends it with the folder dialog", async () => {
    await mount((b) => {
      b.state.pick = project;
    });
    await click("New project");
    await setValue(host.querySelector("form input")!, "  My plan  ");
    await submit(host.querySelector("form")!);
    expect(called("create_project")[0].args).toEqual({ name: "  My plan  " }); // Rust trims and checks
    expect(onOpenProject).toHaveBeenCalledWith(project);
  });

  it("a cancelled New project dialog opens nothing and keeps the form", async () => {
    await mount();
    await click("New project");
    await submit(host.querySelector("form")!);
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("Quick open goes to the quick view without any command", async () => {
    await mount();
    await click("Quick open");
    expect(onQuickOpen).toHaveBeenCalledOnce();
    expect(called("open_markdown")).toHaveLength(0);
  });

  it("Remove asks first, says the folder stays, and removes only after confirming", async () => {
    await mount((b) => {
      b.state.library = [item("proj_a", "Alpha")];
    });
    await click("Remove Alpha");
    const dialog = host.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("stay on your disk");
    expect(called("remove_from_library")).toHaveLength(0);

    await click("Keep");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(called("remove_from_library")).toHaveLength(0);
    expect(host.querySelector(".project-card")).not.toBeNull();

    await click("Remove Alpha");
    await click("Remove from list");
    expect(called("remove_from_library")[0].args).toEqual({ projectId: "proj_a" });
    expect(host.querySelector(".project-card")).toBeNull();
  });

  it("Rename sends the new name and shows what Rust now returns", async () => {
    await mount((b) => {
      b.state.library = [item("proj_a", "Alpha")];
    });
    await click("Rename Alpha");
    await setValue(host.querySelector("input")!, "Renamed");
    await submit(host.querySelector("form")!);
    expect(called("rename_project")[0].args).toEqual({ projectId: "proj_a", name: "Renamed" });
    expect(host.querySelector(".project-card h3")!.textContent).toBe("Renamed");
  });

  it("a command error shows as an alert and the user stays on the home screen", async () => {
    await mount((b) => {
      b.state.library = [item("proj_a", "Alpha")];
    });
    backend.state.failWith = { kind: "missing", message: "that folder is gone" };
    await click("Open Alpha");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("that folder is gone");
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(host.querySelector("h2")!.textContent).toBe("Projects");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it.each([
    ["2026-11-20T11:59:40Z", "just now"],
    ["2026-11-20T11:59:00Z", "1 minute ago"],
    ["2026-11-20T11:15:00Z", "45 minutes ago"],
    ["2026-11-20T09:00:00Z", "3 hours ago"],
    ["2026-11-18T12:00:00Z", "2 days ago"],
    ["2026-09-01T12:00:00Z", "2026-09-01"],
    ["garbage", "garbage"],
  ])("%s is %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});
