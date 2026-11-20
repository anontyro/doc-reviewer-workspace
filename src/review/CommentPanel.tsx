import { useState } from "react";
import type { AnnotationView } from "../api";

interface Props {
  views: AnnotationView[];
  error: string | null;
  onSelect: (v: AnnotationView) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}

/** What is wrong with where a comment points now, or null if nothing (F2 spec D20). */
function badges(v: AnnotationView): string[] {
  const out: string[] = [];
  if (v.current.confidence === "ambiguous") out.push(`Matches ${v.current.candidates} places`);
  if (v.current.confidence === "orphaned") out.push("Not found in this file");
  if (v.stale) out.push("Made on an earlier version");
  return out;
}

function Item({
  v,
  onSelect,
  onEdit,
  onDelete,
}: Omit<Props, "views" | "error"> & { v: AnnotationView }) {
  const [draft, setDraft] = useState<string | null>(null); // null: not editing
  const { id, text, anchor } = v.annotation;
  return (
    <li>
      <button type="button" className="comment-jump" onClick={() => onSelect(v)}>
        <q className="comment-quote">{anchor.exact}</q>
      </button>
      {badges(v).map((b) => (
        <span key={b} className="comment-badge">
          {b}
        </span>
      ))}
      {draft === null ? (
        <>
          <p className="comment-text">{text}</p>
          <button type="button" onClick={() => setDraft(text)}>
            Edit
          </button>
          <button type="button" onClick={() => onDelete(id)}>
            Delete
          </button>
        </>
      ) : (
        <>
          <textarea
            aria-label="Edit comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            disabled={draft.trim() === ""}
            onClick={() => {
              onEdit(id, draft);
              setDraft(null);
            }}
          >
            Save
          </button>
          <button type="button" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </>
      )}
    </li>
  );
}

/** The comments for the open document. The text is shown exactly as typed. */
export default function CommentPanel({ views, error, ...handlers }: Props) {
  return (
    <aside className="comment-panel" aria-label="Comments">
      <h2>Comments</h2>
      {error && <p role="alert">{error}</p>}
      {views.length === 0 && <p>No comments yet. Select text to add one.</p>}
      <ul>
        {views.map((v) => (
          <Item key={v.annotation.id} v={v} {...handlers} />
        ))}
      </ul>
    </aside>
  );
}
