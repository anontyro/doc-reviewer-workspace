export interface Endings {
  /** The separator the editor must use so the text round-trips byte for byte. */
  separator: "\n" | "\r\n";
  /** Why the file may not be edited here, or null (F3 spec D20). */
  readOnlyReason: string | null;
}

export const MIXED_ENDINGS_MESSAGE =
  "This file mixes line endings (or has a lone carriage return), so editing it here could change lines you did not touch. It is shown read-only.";

/** Reads a file's line endings. All `\n` or all `\r\n` can be edited. Anything else opens read-only. */
export function detectEndings(text: string): Endings {
  let crlf = 0;
  let lf = 0;
  let lone = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") {
        crlf++;
        i++;
      } else lone++;
    } else if (text[i] === "\n") lf++;
  }
  if (lone > 0 || (crlf > 0 && lf > 0)) {
    return { separator: "\n", readOnlyReason: MIXED_ENDINGS_MESSAGE };
  }
  return { separator: crlf > 0 ? "\r\n" : "\n", readOnlyReason: null };
}
