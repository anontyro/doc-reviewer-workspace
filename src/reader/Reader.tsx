import { useEffect, useRef, useState } from "react";
import { openMarkdown, type OpenedDocument } from "../api";
import FloatingMenu from "../review/FloatingMenu";
import CommentPanel from "../review/CommentPanel";
import { findRange, paintHighlights } from "../review/highlight";
import { useAnnotations, type Comment } from "../review/useAnnotations";
import { useSelection } from "../review/useSelection";
import "../review/review.css";

/** Shows a rendered Markdown file with its comments. The file is read-only: no editing, no source toggle (F2 spec D7). */
export default function Reader() {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const article = useRef<HTMLElement>(null);
  const { selected, restore } = useSelection(article, locked, doc);
  const { comments, add, reset } = useAnnotations();

  const open = async () => {
    try {
      const opened = await openMarkdown();
      if (opened) {
        setDoc(opened); // cancelled: keep what is open
        reset();
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const root = article.current;
    const ranges = root ? comments.flatMap((c) => findRange(root, c) ?? []) : [];
    paintHighlights(ranges);
    return () => paintHighlights([]);
  }, [comments, doc]);

  const jump = (c: Comment) => {
    const root = article.current;
    const range = root && findRange(root, c);
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
          <CommentPanel comments={comments} onSelect={jump} />
          <FloatingMenu selected={selected} onLock={setLocked} onClose={restore} onSave={add} />
        </div>
      )}
    </section>
  );
}
