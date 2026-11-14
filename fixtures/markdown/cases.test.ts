import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = __dirname;

interface Expected {
  confidence: "resolved" | "ambiguous";
  heading_path: string[] | null;
  source_text?: string;
  range_utf8?: [number, number];
  range_utf16?: [number, number];
  candidates?: number;
}
interface Case {
  id: string;
  file: string;
  selected: string;
  prefix: string;
  suffix: string;
  expected: Expected;
}
const data = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")) as {
  hostile_files: string[];
  cases: Case[];
};
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".md"));

describe("markdown selection cases", () => {
  it("has unique ids and only references fixtures that exist", () => {
    const ids = data.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of data.cases) expect(existsSync(join(dir, c.file)), c.id).toBe(true);
    for (const f of data.hostile_files) expect(fixtures).toContain(f);
  });

  it("covers every fixture file with at least one case", () => {
    const covered = new Set(data.cases.map((c) => c.file));
    for (const f of fixtures) expect(covered, f).toContain(f);
  });

  it("slices exactly the expected source text for every resolved case, in bytes and UTF-16", () => {
    const resolved = data.cases.filter((c) => c.expected.confidence === "resolved");
    expect(resolved.length).toBeGreaterThan(0);
    for (const c of resolved) {
      const e = c.expected;
      const bytes = readFileSync(join(dir, c.file));
      const [b0, b1] = e.range_utf8!;
      expect(bytes.subarray(b0, b1).toString("utf8"), `${c.id} utf8`).toBe(e.source_text);
      const [u0, u1] = e.range_utf16!;
      expect(bytes.toString("utf8").slice(u0, u1), `${c.id} utf16`).toBe(e.source_text);
      expect(e.heading_path?.length, `${c.id} heading_path`).toBeGreaterThan(0);
    }
  });

  it("exercises the byte-vs-UTF-16 difference", () => {
    const differs = data.cases.filter(
      (c) =>
        c.expected.range_utf8 &&
        JSON.stringify(c.expected.range_utf8) !== JSON.stringify(c.expected.range_utf16),
    );
    expect(differs.map((c) => c.file)).toContain("unicode.md");
  });

  it("has ambiguous cases for repeated text, duplicate headings and a table cell, with no guessed range", () => {
    const ambiguous = data.cases.filter((c) => c.expected.confidence === "ambiguous");
    for (const f of ["repeated-text.md", "duplicate-headings.md", "tables.md"]) {
      expect(
        ambiguous.map((c) => c.file),
        f,
      ).toContain(f);
    }
    for (const c of ambiguous) {
      expect(c.expected.candidates, c.id).toBeGreaterThanOrEqual(2);
      expect(c.expected.range_utf8, c.id).toBeUndefined();
      expect(c.expected.range_utf16, c.id).toBeUndefined();
    }
  });

  it("uses CRLF only in crlf.md and non-BMP text in unicode.md", () => {
    const crlf = readFileSync(join(dir, "crlf.md"), "utf8");
    expect(crlf).toContain("\r\n");
    expect(crlf.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const unicode = readFileSync(join(dir, "unicode.md"), "utf8");
    expect([...unicode].some((ch) => ch.codePointAt(0)! > 0xffff)).toBe(true);
  });
});
