export interface Capture {
  selected: string;
  /** Rendered text before and after the selection inside the same block (at most CONTEXT chars). */
  prefix: string;
  suffix: string;
}

const CONTEXT = 40;
// Soft line breaks read as a space (cases.json).
const flat = (s: string) => s.replace(/\r?\n/g, " ");
const BLOCK = "li,p,h1,h2,h3,h4,h5,h6,td,th,pre";

/** Turns a DOM selection range into the engine input. Returns null for a collapsed range or one that crosses blocks. */
export function captureSelection(range: Range): Capture | null {
  const el = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
  const block = el(range.startContainer)?.closest(BLOCK);
  if (!block || range.collapsed || block !== el(range.endContainer)?.closest(BLOCK)) return null;
  const before = block.ownerDocument.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const after = block.ownerDocument.createRange();
  after.setStart(range.endContainer, range.endOffset);
  // A list item's own text ends where its nested list starts.
  const nested = block.querySelector(":scope > ul, :scope > ol");
  if (nested)
    after.setEndBefore(nested); // the newline before the nested list is markup, not text
  else after.setEnd(block, block.childNodes.length);
  return {
    selected: flat(range.toString()),
    prefix: flat(before.toString()).slice(-CONTEXT),
    suffix: flat(nested ? after.toString().trimEnd() : after.toString()).slice(0, CONTEXT),
  };
}
