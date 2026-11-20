import { useEffect, useState } from "react";
import { captureSelection, type Capture } from "./capture";

export interface Rect {
  top: number;
  bottom: number;
  left: number;
}

export type Selected =
  | { kind: "none" }
  /** A selection exists but cannot become a comment: it crosses blocks. */
  | { kind: "unsupported" }
  | { kind: "ok"; capture: Capture; rect: Rect; range: Range };

/**
 * Tracks the user's selection inside `container`. It updates on mouse up and key up, and clears when the selection
 * collapses. While `locked` (the composer is open) it keeps the last value, because focusing the text box collapses
 * the document selection.
 */
export function useSelection(
  container: React.RefObject<HTMLElement | null>,
  locked: boolean,
  /** Anything that changes when the container element is (re)mounted, such as the open document. */
  mounted: unknown,
) {
  const [selected, setSelected] = useState<Selected>({ kind: "none" });

  useEffect(() => {
    const root = container.current;
    if (!root || locked) return;
    const read = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setSelected({ kind: "none" });
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return setSelected({ kind: "none" });
      const capture = captureSelection(range);
      if (!capture) return setSelected({ kind: "unsupported" });
      // jsdom has no layout, so tests get a zero rect.
      const r = range.getBoundingClientRect?.() ?? { top: 0, bottom: 0, left: 0 };
      setSelected({
        kind: "ok",
        capture,
        rect: { top: r.top, bottom: r.bottom, left: r.left },
        range: range.cloneRange(),
      });
    };
    const clearIfCollapsed = () => {
      if (window.getSelection()?.isCollapsed) setSelected({ kind: "none" });
    };
    root.addEventListener("mouseup", read);
    root.addEventListener("keyup", read);
    document.addEventListener("selectionchange", clearIfCollapsed);
    return () => {
      root.removeEventListener("mouseup", read);
      root.removeEventListener("keyup", read);
      document.removeEventListener("selectionchange", clearIfCollapsed);
    };
  }, [container, locked, mounted]);

  /** Puts focus and the selection back in the document (F2 spec D11). */
  const restore = (range?: Range) => {
    container.current?.focus();
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  return { selected, restore };
}
