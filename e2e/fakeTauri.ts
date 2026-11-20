import type { Page } from "@playwright/test";

export const HTML = `<h1>Plan</h1>
<p>The system must be local-first.</p>
<p>The system must be local-first.</p>
<h2>Details</h2>
<p>Use the cache when offline. The cache is local.</p>
<p>See <a href="https://example.com/out" id="ext">the docs</a> for more.</p>`;

/** Replaces the Tauri bridge with a small in-page Rust stand-in. Resolves by counting the quote with its context. */
export async function installFakeTauri(page: Page, opts: { failOpen?: boolean } = {}) {
  await page.addInitScript(
    ({ html, failOpen }) => {
      const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
      let next = 1;
      let views: { annotation: Record<string, unknown>; current: unknown; stale: boolean }[] = [];
      const resolve = (a: { selected: string; prefix: string; suffix: string }) => {
        const n = text.split(a.prefix + a.selected + a.suffix).length - 1;
        return {
          confidence: n === 1 ? "resolved" : n === 0 ? "orphaned" : "ambiguous",
          heading_path: ["Plan"],
          source_range: n === 1 ? { start: 0, end: 1 } : null,
          candidates: n,
        };
      };
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: async (cmd: string, args: Record<string, string>) => {
          if (cmd === "open_markdown") {
            if (failOpen) throw { kind: "not_utf8", message: "not valid UTF-8" };
            return {
              path: "/tmp/plan.md",
              name: "plan.md",
              document_id: "doc_0123456789abcdef",
              version_id: "ver_0123456789abcdef",
              source_hash: "0".repeat(64),
              source: "",
              html,
            };
          }
          if (cmd === "resolve_selection") return resolve(args as never);
          if (cmd === "list_annotations") return views;
          if (cmd === "generate_feedback")
            return views.map((v) => `- ${v.annotation.text}`).join("\n");
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
            views = [...views, { annotation, current: resolve(args as never), stale: false }];
            return annotation;
          }
          throw new Error(`unexpected command ${cmd}`);
        },
      };
    },
    { html: HTML, failOpen: opts.failOpen ?? false },
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
  await page.getByRole("button", { name: "Open Markdown file" }).click();
  await page.locator("article h1").waitFor();
}
