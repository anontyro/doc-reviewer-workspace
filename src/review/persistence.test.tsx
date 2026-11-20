// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AnnotationView, OpenedDocument } from "../api";
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
  html: "<h1>Title</h1><p>Alpha beta gamma.</p><p>Second paragraph.</p>",
};

let root: Root | undefined;
let host: HTMLElement;
let backend: ReturnType<typeof fakeBackend>;

/** A comment as Rust returns it, with overrides for how it stands now. */
function saved(
  id: string,
  exact: string,
  text: string,
  over: Partial<AnnotationView> = {},
  context = { prefix: "", suffix: "" },
): AnnotationView {
  const base = fakeBackend(doc);
  base.state.next = Number(id.slice(4));
  base.handler("create_annotation", { selected: exact, ...context, text });
  return { ...base.state.views[0], ...over };
}

async function mount(views: AnnotationView[] = []) {
  backend = fakeBackend(doc);
  backend.state.views = views;
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
  delete (globalThis as { CSS?: unknown }).CSS;
  delete (globalThis as { Highlight?: unknown }).Highlight;
  clearMocks();
});

const panel = () => host.querySelector("aside")!;
const texts = () => [...panel().querySelectorAll(".comment-text")].map((e) => e.textContent);
const badges = () => [...panel().querySelectorAll(".comment-badge")].map((e) => e.textContent);
const commands = () => backend.state.calls.map((c) => c.cmd);
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const button = (label: string) =>
  [...panel().querySelectorAll("button")].find((b) => b.textContent === label)!;

async function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("saved comments", () => {
  it("are loaded when a document opens, with a badge for each way they can be out of date", async () => {
    const ok = saved("rev_0001", "beta", "fine");
    const ambiguous = saved("rev_0002", "Alpha", "two places", {
      current: { confidence: "ambiguous", heading_path: null, source_range: null, candidates: 2 },
    });
    const orphaned = saved("rev_0003", "gone", "missing", {
      current: { confidence: "orphaned", heading_path: null, source_range: null, candidates: 0 },
    });
    const stale = saved("rev_0004", "gamma", "old", { stale: true });
    await mount([ok, ambiguous, orphaned, stale]);

    expect(texts()).toEqual(["fine", "two places", "missing", "old"]);
    expect(badges()).toEqual([
      "Matches 2 places",
      "Not found in this file",
      "Made on an earlier version",
    ]);
  });

  it("are created through Rust, and the panel shows the list Rust returns", async () => {
    await mount();
    const range = document.createRange();
    const p = host.querySelector("article p")!.firstChild!;
    range.setStart(p, 6);
    range.setEnd(p, 10);
    window.getSelection()!.addRange(range);
    await act(async () => {
      host.querySelector("article")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "m", metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    await typeInto(host.querySelector("textarea")!, " as typed ");
    await act(async () => {
      host
        .querySelector("textarea")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
        );
    });

    const create = backend.state.calls.find((c) => c.cmd === "create_annotation")!;
    expect(create.args).toEqual({
      selected: "beta",
      prefix: "Alpha ",
      suffix: " gamma.",
      text: " as typed ",
    });
    expect(commands().slice(commands().indexOf("create_annotation"))).toEqual([
      "create_annotation",
      "list_annotations",
    ]);
    // Change what Rust would return: the panel follows Rust, not what was typed.
    expect(texts()).toEqual([" as typed "]);
  });

  it("can be edited and deleted through Rust", async () => {
    await mount([saved("rev_0001", "beta", "first"), saved("rev_0002", "gamma", "second")]);

    await click(panel().querySelectorAll("button")[1]); // Edit on the first comment
    await typeInto(panel().querySelector("textarea")!, "changed");
    await click(button("Save"));
    expect(backend.state.calls.find((c) => c.cmd === "update_annotation")!.args).toEqual({
      id: "rev_0001",
      text: "changed",
    });
    expect(texts()).toEqual(["changed", "second"]);

    await click(panel().querySelectorAll("li")[1].querySelectorAll("button")[2]); // Delete on the second
    expect(backend.state.calls.find((c) => c.cmd === "delete_annotation")!.args).toEqual({
      id: "rev_0002",
    });
    expect(texts()).toEqual(["changed"]);
  });

  it("show the error and keep the panel as it was when a command fails", async () => {
    await mount([saved("rev_0001", "beta", "first")]);
    backend.state.failWith = { kind: "io", message: "could not save comments: disk full" };
    await click(button("Delete"));
    expect(panel().querySelector("[role=alert]")?.textContent).toBe(
      "could not save comments: disk full",
    );
    expect(texts()).toEqual(["first"]);

    backend.state.failWith = null;
    await click(button("Delete"));
    expect(texts()).toEqual([]);
    expect(panel().querySelector("[role=alert]")).toBeNull();
  });

  it("are highlighted only when Rust says they still resolve", async () => {
    const painted: Range[][] = [];
    (globalThis as { CSS?: unknown }).CSS = {
      highlights: {
        set: (_: string, h: { ranges: Range[] }) => painted.push(h.ranges),
        delete: () => {},
      },
    };
    (globalThis as { Highlight?: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    };
    const good = saved("rev_0001", "beta", "resolves", {}, { prefix: "Alpha ", suffix: " gamma." });
    // "gamma" is in the page exactly once, so only Rust's verdict keeps it from being painted.
    const orphaned = saved(
      "rev_0002",
      "gamma",
      "rust says gone",
      {
        current: { confidence: "orphaned", heading_path: null, source_range: null, candidates: 0 },
      },
      { prefix: "Alpha beta ", suffix: "." },
    );
    await mount([good, orphaned]);

    const last = painted[painted.length - 1];
    expect(last.map((r) => r.toString())).toEqual(["beta"]);
  });
});
