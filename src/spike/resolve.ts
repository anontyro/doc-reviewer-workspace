import type { Nodes, Parents, Root } from "mdast";
import { parser } from "./markdown";

export type Confidence = "resolved" | "ambiguous" | "orphaned";
export interface Resolved {
  confidence: Confidence;
  headingPath: string[] | null;
  /** UTF-16 code units, half-open. Only for `resolved`. */
  range: [number, number] | null;
  candidates: number;
}

/** One rendered block with the source span of every rendered char. */
interface Block {
  chars: string[];
  spans: [number, number][];
  path: string[];
}

const same = (a: string[] | null, b: string[] | null) => JSON.stringify(a) === JSON.stringify(b);

function offsets(n: Nodes): [number, number] | null {
  const s = n.position?.start.offset;
  const e = n.position?.end.offset;
  return s === undefined || e === undefined ? null : [s, e];
}

function push(b: Block, text: string, start: number, exact: boolean, span: [number, number]) {
  // shortcut: text that differs from the source (entities, escapes) maps every char to the whole node.
  let i = start;
  for (const c of text) {
    const crlf = c === "\r" && text[i - start + 1] === "\n";
    if (c === "\n" && text[i - start - 1] === "\r") {
      i += 1; // second half of a CRLF, already pushed
      continue;
    }
    // Soft line breaks read as a space (cases.json); CRLF is one break.
    b.chars.push(crlf || c === "\n" ? " " : c);
    b.spans.push(exact ? [i, i + (crlf ? 2 : c.length)] : span);
    i += c.length;
  }
}

function inline(n: Parents, src: string, b: Block) {
  for (const c of n.children) {
    const span = offsets(c);
    if (!span) continue;
    if (c.type === "text" && src.slice(...span) === c.value) push(b, c.value, span[0], true, span);
    else if (c.type === "text") push(b, c.value, span[0], false, span);
    else if (c.type === "inlineCode") {
      const raw = src.slice(...span);
      const lead = raw.length - raw.replace(/^`+/, "").length;
      push(b, c.value, span[0] + lead, raw.slice(lead, lead + c.value.length) === c.value, span);
    } else if (c.type === "break") push(b, "\n", span[0], false, span);
    else if (c.type === "html") continue;
    else if ("children" in c) inline(c, src, b);
  }
}

function blocks(src: string): Block[] {
  const root = parser().parse(src) as Root;
  const out: Block[] = [];
  let path: string[] = [];
  const walk = (n: Nodes) => {
    const b: Block = { chars: [], spans: [], path: [] };
    if (n.type === "heading" || n.type === "paragraph" || n.type === "tableCell") {
      inline(n, src, b);
      if (n.type === "heading") path = [...path.slice(0, n.depth - 1), b.chars.join("")];
    } else if (n.type === "code") {
      const span = offsets(n);
      if (span) {
        // Fenced content starts on the line after the opening fence.
        const start = src.indexOf("\n", span[0]) + 1;
        push(b, n.value, start, src.slice(start, start + n.value.length) === n.value, span);
        push(b, "\n", start + n.value.length, false, [
          start + n.value.length,
          start + n.value.length,
        ]); // mdast drops it, the DOM keeps it
      }
    } else {
      if ("children" in n) n.children.forEach(walk);
      return;
    }
    b.path = path;
    out.push(b);
  };
  walk(root);
  return out;
}

/** Same contract as the Rust engine: one match resolves, several are ambiguous with no range, none is orphaned. */
export function resolveAnchor(
  source: string,
  selected: string,
  prefix = "",
  suffix = "",
): Resolved {
  const sel = [...selected];
  const [pre, suf] = [[...prefix], [...suffix]];
  const hits: { range: [number, number]; path: string[] }[] = [];
  if (sel.length)
    for (const b of blocks(source))
      for (let i = 0; i + sel.length <= b.chars.length; i++) {
        const end = i + sel.length;
        if (
          sel.every((c, k) => b.chars[i + k] === c) &&
          pre.every((c, k) => b.chars[i - pre.length + k] === c) &&
          suf.every((c, k) => b.chars[end + k] === c) &&
          i >= pre.length
        )
          hits.push({ range: [b.spans[i][0], b.spans[end - 1][1]], path: b.path });
      }
  const headingPath =
    hits.length && hits.every((h) => same(h.path, hits[0].path)) ? hits[0].path : null;
  if (hits.length === 1)
    return { confidence: "resolved", headingPath, range: hits[0].range, candidates: 1 };
  return {
    confidence: hits.length ? "ambiguous" : "orphaned",
    headingPath,
    range: null,
    candidates: hits.length,
  };
}
