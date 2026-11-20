import { describe, expect, it } from "vitest";
import { detectEndings, MIXED_ENDINGS_MESSAGE } from "./lineEndings";

describe("detectEndings", () => {
  it.each([
    ["LF", "# A\n\ntext\n", "\n"],
    ["CRLF", "# A\r\n\r\ntext\r\n", "\r\n"],
    ["no trailing newline", "# A\n\ntext", "\n"],
    ["CRLF without trailing newline", "a\r\nb", "\r\n"],
    ["a single line", "just text", "\n"],
    ["empty", "", "\n"],
  ])("%s can be edited with its own separator", (_name, text, separator) => {
    expect(detectEndings(text)).toEqual({ separator, readOnlyReason: null });
  });

  it.each([
    ["LF and CRLF mixed", "a\r\nb\nc"],
    ["a lone CR", "a\rb"],
    ["a CR at the very end", "a\n\r"],
    ["CRLF with one stray CR", "a\r\nb\r\rc\r\n"],
  ])("%s opens read-only with the reason", (_name, text) => {
    expect(detectEndings(text).readOnlyReason).toBe(MIXED_ENDINGS_MESSAGE);
  });
});
