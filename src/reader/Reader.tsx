import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AnnotationView, OpenedDocument } from "../api";
import ExportPanel from "../review/ExportPanel";
import FloatingMenu from "../review/FloatingMenu";
import CommentPanel from "../review/CommentPanel";
import { findRange, paintHighlights } from "../review/highlight";
import { useAnnotations } from "../review/useAnnotations";
import { useSelection } from "../review/useSelection";
import "../review/review.css";

/**
 * Shows a rendered Markdown document with its comments. The file is read-only here: no editing, no source toggle
 * (F2 spec D7). With `sidebar`, the comment and export panels are drawn into that element instead of beside the text
 * (F3 spec D13, D16).
 */
export default function Reader({
  doc,
  sidebar,
}: {
  doc: OpenedDocument;
  sidebar?: HTMLElement | null;
}) {
  const [locked, setLocked] = useState(false);
  const article = useRef<HTMLElement>(null);
  const { selected, restore } = useSelection(article, locked, doc);
  const { views, error: commentError, add, edit, remove } = useAnnotations(doc);

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

  const comments = (
    <CommentPanel
      views={views}
      error={commentError}
      onSelect={jump}
      onEdit={(id, text) => void edit(id, text)}
      onDelete={(id) => void remove(id)}
    />
  );
  const exporter = <ExportPanel refreshKey={views} />;

  return (
    <section>
      <div className={sidebar ? undefined : "layout"}>
        {/* Only the Rust-rendered, comrak-sanitised html is injected, never the source (F2 spec D7). */}
        <article
          ref={article}
          className="reader"
          tabIndex={-1}
          // Links in a document must never navigate the app window (no network, no losing the UI).
          onClick={(e) => {
            if ((e.target as Element).closest("a")) e.preventDefault();
          }}
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />
        {!sidebar && comments}
        <FloatingMenu
          selected={selected}
          onLock={setLocked}
          onClose={restore}
          onSave={(c, text) => void add(c, text)}
        />
      </div>
      {sidebar
        ? createPortal(
            <>
              {comments}
              {exporter}
            </>,
            sidebar,
          )
        : exporter}
    </section>
  );
}
