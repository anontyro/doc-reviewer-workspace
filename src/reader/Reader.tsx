import { useState } from "react";
import { openMarkdown, type OpenedDocument } from "../api";

/** Shows a rendered Markdown file. Read-only: there is no editing and no source toggle (F2 spec D7). */
export default function Reader() {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    try {
      const opened = await openMarkdown();
      if (opened) setDoc(opened); // cancelled: keep what is open
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <button type="button" onClick={() => void open()}>
        Open Markdown file
      </button>
      {doc && <span className="doc-name"> {doc.name}</span>}
      {error && <p role="alert">{error}</p>}
      {/* Only the Rust-rendered, comrak-sanitised html is injected, never the source (F2 spec D7). */}
      {doc && <article className="reader" dangerouslySetInnerHTML={{ __html: doc.html }} />}
    </section>
  );
}
