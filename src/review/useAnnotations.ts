import { useState } from "react";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
  type AnnotationView,
  type ResolvedAnchor,
} from "../api";
import type { Capture } from "./capture";

/** Why a selection cannot become a comment, or null if it can (F2 spec D12). */
export function refusal(r: ResolvedAnchor): string | null {
  if (r.confidence === "resolved") return null;
  if (r.confidence === "ambiguous")
    return `This selection matches ${r.candidates} places. Select more text.`;
  return "The selected text was not found in the document.";
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The open document's comments. Rust owns them: every change goes through a command and the list shown is always
 * what Rust returns, never a local copy (F2 spec D19). A failed command leaves the list as it was.
 */
export function useAnnotations() {
  const [views, setViews] = useState<AnnotationView[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Runs a command, then re-reads the list. */
  const change = async (command: () => Promise<unknown>) => {
    try {
      await command();
      setViews(await listAnnotations());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  /** Loads the comments of the document that was just opened, dropping the previous document's. */
  const reload = async () => {
    setViews([]);
    await change(async () => {});
  };

  return {
    views,
    error,
    reload,
    add: (capture: Capture, text: string) =>
      change(() =>
        createAnnotation(
          { selected: capture.selected, prefix: capture.prefix, suffix: capture.suffix },
          text,
        ),
      ),
    edit: (id: string, text: string) => change(() => updateAnnotation(id, text)),
    remove: (id: string) => change(() => deleteAnnotation(id)),
  };
}
