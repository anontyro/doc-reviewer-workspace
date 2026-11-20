import type { Comment } from "./useAnnotations";

/** The comments for the open document. The text is shown exactly as typed. */
export default function CommentPanel({
  comments,
  onSelect,
}: {
  comments: Comment[];
  onSelect: (c: Comment) => void;
}) {
  return (
    <aside className="comment-panel" aria-label="Comments">
      <h2>Comments</h2>
      {comments.length === 0 && <p>No comments yet. Select text to add one.</p>}
      <ul>
        {comments.map((c) => (
          <li key={c.id}>
            <button type="button" className="comment-jump" onClick={() => onSelect(c)}>
              <q className="comment-quote">{c.exact}</q>
            </button>
            <p className="comment-text">{c.text}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
