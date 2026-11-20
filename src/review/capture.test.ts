// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { captureSelection } from "./capture";

function select(html: string, startPath: string, start: number, endPath: string, end: number) {
  document.body.innerHTML = html;
  const text = (sel: string) => document.querySelector(sel)!.firstChild!;
  const range = document.createRange();
  range.setStart(text(startPath), start);
  range.setEnd(text(endPath), end);
  return range;
}

describe("captureSelection", () => {
  it("returns the selected text with context from the same block", () => {
    const r = select("<p>The quick brown fox</p>", "p", 4, "p", 9);
    expect(captureSelection(r)).toEqual({
      selected: "quick",
      prefix: "The ",
      suffix: " brown fox",
    });
  });

  it("limits context to 40 characters", () => {
    const long = "a".repeat(100) + "X" + "b".repeat(100);
    const r = select(`<p>${long}</p>`, "p", 100, "p", 101);
    const cap = captureSelection(r)!;
    expect(cap.prefix).toBe("a".repeat(40));
    expect(cap.suffix).toBe("b".repeat(40));
  });

  it("returns null for a collapsed range", () => {
    expect(captureSelection(select("<p>hello</p>", "p", 2, "p", 2))).toBeNull();
  });

  it("returns null for a selection across blocks", () => {
    expect(
      captureSelection(select("<p>one</p><p>two</p>", "p:nth-child(1)", 1, "p:nth-child(2)", 1)),
    ).toBeNull();
  });

  it("reads a soft line break as a space", () => {
    const r = select("<p>one\ntwo three</p>", "p", 0, "p", 7);
    expect(captureSelection(r)?.selected).toBe("one two");
  });

  it("stops a list item's text where its nested list starts", () => {
    const r = select(
      "<ul><li>Outer text\n<ul><li>Inner</li></ul></li></ul>",
      "ul > li",
      0,
      "ul > li",
      5,
    );
    expect(captureSelection(r)).toEqual({ selected: "Outer", prefix: "", suffix: " text" });
  });

  it("does not count the newline before a nested list as text after the selection", () => {
    const r = select(
      "<ul><li>Outer text\n<ul><li>Inner</li></ul></li></ul>",
      "ul > li",
      6,
      "ul > li",
      10,
    );
    expect(captureSelection(r)?.suffix).toBe("");
  });
});
