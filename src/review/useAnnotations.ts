import { useCallback, useState } from "react";
import type { ResolvedAnchor } from "../api";
import type { Capture } from "./capture";

export interface Comment {
  id: string;
  /** Typed by the user, kept exactly as typed. */
  text: string;
  exact: string;
  prefix: string;
  suffix: string;
  headingPath: string[];
}

/** Why a selection cannot become a comment, or null if it can (F2 spec D12). */
export function refusal(r: ResolvedAnchor): string | null {
  if (r.confidence === "resolved") return null;
  if (r.confidence === "ambiguous")
    return `This selection matches ${r.candidates} places. Select more text.`;
  return "The selected text was not found in the document.";
}

/**
 * Comments for the open document, in memory only. R3 replaces the storage with the Rust commands and keeps this
 * hook's shape (F2 spec D14).
 */
export function useAnnotations() {
  const [comments, setComments] = useState<Comment[]>([]);

  const add = useCallback((capture: Capture, resolved: ResolvedAnchor, text: string) => {
    if (refusal(resolved) || text.trim() === "")
      throw new Error("cannot comment on this selection");
    setComments((all) => [
      ...all,
      {
        id: `tmp_${all.length + 1}`,
        text,
        exact: capture.selected,
        prefix: capture.prefix,
        suffix: capture.suffix,
        headingPath: resolved.heading_path ?? [],
      },
    ]);
  }, []);

  const reset = useCallback(() => setComments([]), []);
  return { comments, add, reset };
}
