import type { Page } from "@playwright/test";

export const HTML = `<h1>Plan</h1>
<p>The system must be local-first.</p>
<p>The system must be local-first.</p>
<h2>Details</h2>
<p>Use the cache when offline. The cache is local.</p>
<p>See <a href="https://example.com/out" id="ext">the docs</a> for more.</p>`;

/** Replaces the Tauri bridge with a small in-page Rust stand-in. Resolves by counting the quote with its context. */
export interface FakeProject {
  project_id: string;
  name: string;
  root_path: string;
  last_opened_at: string;
  missing: boolean;
}

/** The second document of a fake project. */
export const NOTES_HTML = `<h1>Notes</h1>
<p>Second document text.</p>`;

/**
 * Replaces the Tauri bridge with a small in-page Rust stand-in. Resolves by counting the quote with its context.
 * Like Rust it has one active document, and comments belong to the document they were made on.
 */
export async function installFakeTauri(
  page: Page,
  opts: { failOpen?: boolean; library?: FakeProject[]; pick?: unknown } = {},
) {
  await page.addInitScript(
    ({ html, notes, failOpen, library, pick }) => {
      const pages: Record<string, string> = { "plan.md": html, "notes.md": notes };
      const textOf = (h: string) =>
        new DOMParser().parseFromString(h, "text/html").body.textContent ?? "";
      type View = { annotation: Record<string, unknown>; current: unknown; stale: boolean };
      const comments: Record<string, View[]> = {};
      let active = "plan.md";
      let next = 1;
      const resolve = (a: { selected: string; prefix: string; suffix: string }) => {
        const n = textOf(pages[active]).split(a.prefix + a.selected + a.suffix).length - 1;
        return {
          confidence: n === 1 ? "resolved" : n === 0 ? "orphaned" : "ambiguous",
          heading_path: ["Plan"],
          source_range: n === 1 ? { start: 0, end: 1 } : null,
          candidates: n,
        };
      };
      const opened = (name: string) => ({
        path: `/tmp/${name}`,
        name,
        document_id: `doc_${name.length.toString(16).padStart(16, "0")}`,
        version_id: "ver_0123456789abcdef",
        source_hash: "0".repeat(64),
        source: "",
        html: pages[name],
      });
      const w = window as unknown as Record<string, unknown>;
      // Every command the app sends, so a test can check what was and was not called.
      const calls: { cmd: string; args: unknown }[] = [];
      w.__calls = calls;
      let items = library as FakeProject[];
      const view = (i: FakeProject) => ({
        id: i.project_id,
        name: i.name,
        root_path: i.root_path,
        documents: [
          { relative_path: "plan.md", name: "plan.md" },
          { relative_path: "notes.md", name: "notes.md" },
          { relative_path: ".plan.md.tmp-1", name: ".plan.md.tmp-1" },
        ],
      });
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: async (cmd: string, args: Record<string, string>) => {
          calls.push({ cmd, args });
          if (cmd === "list_library") return items;
          if (cmd === "create_project" || cmd === "open_project") return pick;
          if (cmd === "open_project_at" || cmd === "rename_project") {
            const item = items.find((i) => i.project_id === args.projectId);
            if (!item || (cmd === "open_project_at" && item.missing))
              throw { kind: "missing", message: "that folder is gone" };
            if (cmd === "rename_project") item.name = args.name;
            return view(item);
          }
          if (cmd === "remove_from_library") {
            items = items.filter((i) => i.project_id !== args.projectId);
            return null;
          }
          if (cmd === "open_markdown") {
            if (failOpen) throw { kind: "not_utf8", message: "not valid UTF-8" };
            active = "plan.md";
            return opened("plan.md");
          }
          if (cmd === "open_project_document") {
            if (!(args.relativePath in pages)) throw { kind: "invalid", message: "not a document" };
            active = args.relativePath;
            return opened(active);
          }
          if (cmd === "resolve_selection") return resolve(args as never);
          if (cmd === "list_annotations") return comments[active] ?? [];
          if (cmd === "generate_feedback")
            return (comments[active] ?? []).map((v) => `- ${v.annotation.text}`).join("\n");
          if (cmd === "create_annotation") {
            const id = `rev_${String(next++).padStart(4, "0")}`;
            const annotation = {
              schema_version: "1.0.0",
              id,
              round_id: "rnd_0001",
              action_type: "comment",
              text: args.text,
              anchor: {
                exact: args.selected,
                prefix: args.prefix,
                suffix: args.suffix,
                heading_path: ["Plan"],
                source_range: { start: 0, end: 1 },
                source_hash: "0".repeat(64),
                confidence: "resolved",
              },
              status: "open",
              created_at: "2026-11-20T10:00:00Z",
              updated_at: "2026-11-20T10:00:00Z",
            };
            comments[active] = [
              ...(comments[active] ?? []),
              { annotation, current: resolve(args as never), stale: false },
            ];
            return annotation;
          }
          throw new Error(`unexpected command ${cmd}`);
        },
      };
    },
    {
      html: HTML,
      notes: NOTES_HTML,
      failOpen: opts.failOpen ?? false,
      library: opts.library ?? [],
      pick: opts.pick ?? null,
    },
  );
}

/** Selects `phrase` inside the article with a real mouse press and release, so the app sees a real mouseup. */
export async function selectPhrase(page: Page, phrase: string, nth = 0) {
  const box = await page.locator("article").boundingBox();
  await page.mouse.move(box!.x + 5, box!.y + 5);
  await page.mouse.down();
  await page.evaluate(
    ({ phrase, nth }) => {
      const walker = document.createTreeWalker(
        document.querySelector("article")!,
        NodeFilter.SHOW_TEXT,
      );
      let seen = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(phrase);
        if (i >= 0 && seen++ === nth) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + phrase.length);
          const s = getSelection()!;
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
      }
      throw new Error(`phrase not found: ${phrase}`);
    },
    { phrase, nth },
  );
  await page.mouse.up();
}

export async function openDoc(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick open" }).click();
  await page.locator("article h1").waitFor();
}
