// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findRange } from "./highlight";

function dom(html: string): HTMLElement {
  document.body.innerHTML = `<article>${html}</article>`;
  return document.querySelector("article")!;
}

describe("findRange", () => {
  it("returns the range when the quote occurs exactly once", () => {
    const root = dom("<p>Alpha beta gamma.</p><p>Other text.</p>");
    const r = findRange(root, { exact: "beta", prefix: "Alpha ", suffix: " gamma." })!;
    expect(r.toString()).toBe("beta");
  });

  it("returns null when the quote is not there", () => {
    const root = dom("<p>Alpha beta gamma.</p>");
    expect(findRange(root, { exact: "delta", prefix: "", suffix: "" })).toBeNull();
  });

  it("returns null when it occurs twice with the same context, rather than picking one", () => {
    const root = dom("<p>Repeat me.</p><p>Repeat me.</p>");
    expect(findRange(root, { exact: "Repeat me.", prefix: "", suffix: "" })).toBeNull();
  });

  it("uses the context to pick one of two occurrences", () => {
    const root = dom("<p>foo bar. foo baz.</p>");
    const r = findRange(root, { exact: "foo", prefix: "foo bar. ", suffix: " baz." })!;
    expect(r.startOffset).toBe(9);
  });

  it("treats a context shorter than the capture limit as an edge of the block", () => {
    const root = dom("<p>word and word</p>");
    // Empty prefix means the quote started its block, so only the first "word" matches.
    expect(findRange(root, { exact: "word", prefix: "", suffix: " and word" })!.startOffset).toBe(
      0,
    );
    expect(findRange(root, { exact: "word", prefix: "word and ", suffix: "" })!.startOffset).toBe(
      9,
    );
  });

  it("never matches across two blocks", () => {
    const root = dom("<p>end of one</p><p>start of two</p>");
    expect(findRange(root, { exact: "one start", prefix: "", suffix: "" })).toBeNull();
  });

  it("spans inline elements inside one block", () => {
    const root = dom("<p>an <strong>in</strong> bold</p>");
    const r = findRange(root, { exact: "an in bold", prefix: "", suffix: "" })!;
    expect(r.toString()).toBe("an in bold");
  });

  it("reads a soft line break as a space", () => {
    const root = dom("<p>one\ntwo three</p>");
    expect(findRange(root, { exact: "one two", prefix: "", suffix: " three" })!.toString()).toBe(
      "one\ntwo",
    );
  });

  it("keeps a list item's own text apart from its nested list", () => {
    const root = dom("<ul><li>Outer\n<ul><li>Inner</li></ul></li></ul>");
    expect(findRange(root, { exact: "Inner", prefix: "", suffix: "" })!.toString()).toBe("Inner");
    expect(findRange(root, { exact: "Outer", prefix: "", suffix: "" })!.toString()).toBe("Outer");
  });
});
