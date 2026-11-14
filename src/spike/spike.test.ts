// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureSelection } from "./capture";
import { renderMarkdown } from "./markdown";
import { resolveAnchor } from "./resolve";

const dir = join(__dirname, "../../fixtures/markdown");
interface Case {
  id: string;
  file: string;
  selected: string;
  prefix: string;
  suffix: string;
  expected: {
    confidence: "resolved" | "ambiguous";
    heading_path: string[] | null;
    range_utf16?: [number, number];
    candidates?: number;
  };
}
const data = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")) as {
  hostile_files: string[];
  cases: Case[];
};
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const hashes = () =>
  readdirSync(dir).map((f) =>
    createHash("sha256")
      .update(readFileSync(join(dir, f)))
      .digest("hex"),
  );

/** A DOM range over the one place in the rendered fixture where prefix + selected + suffix occurs. */
function rangeFor(c: Case): Range {
  const doc = new DOMParser().parseFromString(renderMarkdown(read(c.file)), "text/html");
  for (const block of doc.querySelectorAll("li,p,h1,h2,h3,h4,h5,h6,td,th,pre")) {
    const text = (block.textContent ?? "").replace(/\r?\n/g, " ");
    const at = text.indexOf(c.prefix + c.selected + c.suffix);
    if (at < 0) continue;
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const find = (offset: number, isEnd: boolean): [Node, number] => {
      let n: Node | null;
      let seen = 0;
      while ((n = walker.nextNode())) {
        const len = n.textContent!.length;
        if (isEnd ? offset <= seen + len : offset < seen + len) return [n, offset - seen];
        seen += len;
      }
      throw new Error(`${c.id}: offset ${offset} not in block`);
    };
    const start = at + c.prefix.length;
    const range = doc.createRange();
    walker.currentNode = block;
    range.setStart(...find(start, false));
    walker.currentNode = block;
    range.setEnd(...find(start + c.selected.length, true));
    return range;
  }
  throw new Error(`${c.id}: selection not found in rendered output`);
}

describe("engine A (TypeScript) against the shared cases", () => {
  it("passes every case, using DOM ranges for the resolved ones", () => {
    const before = hashes();
    const failures: string[] = [];
    for (const c of data.cases) {
      const e = c.expected;
      let ok: boolean;
      let got: unknown;
      if (e.confidence === "resolved") {
        const cap = captureSelection(rangeFor(c));
        const r = cap && resolveAnchor(read(c.file), cap.selected, cap.prefix, cap.suffix);
        got = r;
        ok =
          cap?.selected === c.selected &&
          r?.confidence === "resolved" &&
          JSON.stringify(r.range) === JSON.stringify(e.range_utf16) &&
          JSON.stringify(r.headingPath) === JSON.stringify(e.heading_path);
      } else {
        const r = resolveAnchor(read(c.file), c.selected, c.prefix, c.suffix);
        got = r;
        ok =
          r.confidence === "ambiguous" &&
          r.range === null &&
          r.candidates === e.candidates &&
          JSON.stringify(r.headingPath) === JSON.stringify(e.heading_path);
      }
      console.log(`${ok ? "PASS" : "FAIL"} ${c.id}`);
      if (!ok) failures.push(`${c.id}: got ${JSON.stringify(got)}, expected ${JSON.stringify(e)}`);
    }
    console.log(
      `engine A (TS): ${data.cases.length - failures.length}/${data.cases.length} cases passed`,
    );
    expect(failures).toEqual([]);
    expect(hashes()).toEqual(before);
  });

  it("emits data-sourcepos on blocks in comrak's format", () => {
    const html = renderMarkdown("# T\n\nhello **world**\n");
    expect(html).toContain('<h1 data-sourcepos="1:1-1:3">');
    expect(html).toContain('<p data-sourcepos="3:1-3:15">');
  });

  it("renders the hostile fixture with no executable content", () => {
    for (const f of data.hostile_files) {
      const html = renderMarkdown(read(f));
      expect(html, f).not.toMatch(/<script|<iframe|<object|<embed|\son\w+\s*=|javascript:/i);
    }
  });

  it("refuses a selection that crosses blocks", () => {
    const doc = new DOMParser().parseFromString("<p>one</p><p>two</p>", "text/html");
    const r = doc.createRange();
    r.setStart(doc.querySelector("p")!.firstChild!, 1);
    r.setEnd(doc.querySelectorAll("p")[1].firstChild!, 1);
    expect(captureSelection(r)).toBeNull();
  });
});
