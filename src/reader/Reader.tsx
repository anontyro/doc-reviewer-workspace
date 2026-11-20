import { useEffect, useRef, useState } from "react";
import { openMarkdown, type AnnotationView, type OpenedDocument } from "../api";
import FloatingMenu from "../review/FloatingMenu";
import CommentPanel from "../review/CommentPanel";
import { findRange, paintHighlights } from "../review/highlight";
import { useAnnotations } from "../review/useAnnotations";
import { useSelection } from "../review/useSelection";
import "../review/review.css";

/** Shows a rendered Markdown file with its comments. The file is read-only: no editing, no source toggle (F2 spec D7). */
export default function Reader() {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const article = useRef<HTMLElement>(null);
  const { selected, restore } = useSelection(article, locked, doc);
  const { views, error: commentError, reload, add, edit, remove } = useAnnotations();

  const open = async () => {
    try {
      const opened = await openMarkdown();
      if (opened) {
        setDoc(opened); // cancelled: keep what is open
        void reload();
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const root = article.current;
    // Rust decides what still points somewhere. Only a quote it resolves is painted.
    const ranges = root
      ? views.flatMap((v) =>
          v.current.confidence === "resolved" ? (findRange(root, v.annotation.anchor) ?? []) : [],
        )
      : [];
    paintHighlights(ranges);
    return () => paintHighlights([]);
  }, [views, doc]);

  const jump = (v: AnnotationView) => {
    const root = article.current;
    const range = root && findRange(root, v.annotation.anchor);
    if (!range) return; // no highlight for an ambiguous or missing quote; the panel still shows it
    (range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView?.({
      block: "center",
    });
    restore(range);
  };

  return (
    <section>
      <button type="button" onClick={() => void open()}>
        Open Markdown file
      </button>
      {doc && <span className="doc-name"> {doc.name}</span>}
      {error && <p role="alert">{error}</p>}
      {doc && (
        <div className="layout">
          {/* Only the Rust-rendered, comrak-sanitised html is injected, never the source (F2 spec D7). */}
          <article
            ref={article}
            className="reader"
            tabIndex={-1}
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />
          <CommentPanel
            views={views}
            error={commentError}
            onSelect={jump}
            onEdit={(id, text) => void edit(id, text)}
            onDelete={(id) => void remove(id)}
          />
          <FloatingMenu
            selected={selected}
            onLock={setLocked}
            onClose={restore}
            onSave={(c, text) => void add(c, text)}
          />
        </div>
      )}
    </section>
  );
}
