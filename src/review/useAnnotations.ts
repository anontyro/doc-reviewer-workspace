import { useEffect, useState } from "react";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
  type AnnotationView,
  type OpenedDocument,
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
 * The comments of `doc`, the active document. Rust owns them: every change goes through a command and the list shown is always
 * what Rust returns, never a local copy (F2 spec D19). A failed command leaves the list as it was.
 */
export function useAnnotations(doc: OpenedDocument) {
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

  // Loads the comments each time a document is activated. The answer of a document that has since been replaced
  // is dropped, so one document's comments are never shown under another. setState runs only in the callbacks.
  useEffect(() => {
    let current = true;
    listAnnotations().then(
      (list) => {
        if (!current) return;
        setViews(list);
        setError(null);
      },
      (e) => {
        if (!current) return;
        setViews([]); // never leave the previous document's comments showing
        setError(message(e));
      },
    );
    return () => {
      current = false;
    };
  }, [doc]);

  return {
    views,
    error,
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
