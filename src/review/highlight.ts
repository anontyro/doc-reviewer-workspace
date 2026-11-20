import { BLOCK, CONTEXT } from "./capture";

export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}

const flat = (s: string) => s.replace(/\r?\n/g, " ");

/** The text nodes of each block, so a quote can never match across two blocks. */
function blocksOf(container: Element): { text: string; nodes: Text[] }[] {
  const groups = new Map<Element, Text[]>();
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement?.closest(BLOCK);
    if (!block || !container.contains(block)) continue;
    groups.set(block, [...(groups.get(block) ?? []), n as Text]);
  }
  return [...groups].map(([block, nodes]) => {
    const text = flat(nodes.map((n) => n.data).join(""));
    // Same rule as captureSelection: the newline before a nested list is markup, not text.
    return { nodes, text: block.querySelector(":scope > ul, :scope > ol") ? text.trimEnd() : text };
  });
}

/** Where `offset` falls in a block's text nodes. A start prefers the next node, an end the earlier one. */
function locate(nodes: Text[], offset: number, isEnd: boolean): [Text, number] {
  let seen = 0;
  for (const n of nodes) {
    const end = seen + n.data.length;
    if (isEnd ? offset <= end : offset < end) return [n, offset - seen];
    seen = end;
  }
  const last = nodes[nodes.length - 1];
  return [last, last.data.length];
}

/**
 * The DOM range of a stored quote, only if prefix + exact + suffix occurs exactly once (F2 spec D13).
 * A context shorter than the capture limit means the quote sat at that edge of its block, so it must match there.
 */
export function findRange(container: Element, q: Quote): Range | null {
  const found: { nodes: Text[]; start: number }[] = [];
  for (const { text, nodes } of blocksOf(container)) {
    for (let i = text.indexOf(q.exact); i >= 0; i = text.indexOf(q.exact, i + 1)) {
      const before = text.slice(0, i);
      const after = text.slice(i + q.exact.length);
      const prefixOk = q.prefix.length < CONTEXT ? before === q.prefix : before.endsWith(q.prefix);
      const suffixOk = q.suffix.length < CONTEXT ? after === q.suffix : after.startsWith(q.suffix);
      if (prefixOk && suffixOk) found.push({ nodes, start: i });
    }
  }
  if (q.exact === "" || found.length !== 1) return null;
  const { nodes, start } = found[0];
  const range = container.ownerDocument.createRange();
  range.setStart(...locate(nodes, start, false));
  range.setEnd(...locate(nodes, start + q.exact.length, true));
  return range;
}

/** Paints the ranges with the CSS Custom Highlight API. Without it nothing is painted and nothing breaks (Q1). */
export function paintHighlights(ranges: Range[]): void {
  const api = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!api || !HighlightCtor) return;
  if (ranges.length === 0) api.delete("review-comment");
  else api.set("review-comment", new HighlightCtor(...ranges));
}
