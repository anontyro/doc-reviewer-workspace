import { useEffect, useState } from "react";
import { generateFeedback } from "../api";

/**
 * Shows the exact feedback prompt and copies it (F2 spec D25). The text shown is the string that is copied, so the
 * preview and the clipboard cannot differ. While open, it regenerates whenever `refreshKey` changes.
 */
export default function ExportPanel({ refreshKey }: { refreshKey: unknown }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stale = false; // a slow earlier answer must not replace a newer one
    generateFeedback().then(
      (t) => {
        if (stale) return;
        setText(t);
        setError(null);
        setCopied(false);
      },
      (e: unknown) => {
        if (stale) return;
        setText(null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      stale = true;
    };
  }, [open, refreshKey]);

  const copy = async () => {
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError(null);
    } catch (e) {
      setError(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="export-panel" aria-label="Export feedback">
      <button type="button" onClick={() => setOpen(!open)}>
        {open ? "Hide feedback prompt" : "Export feedback"}
      </button>
      {open && (
        <>
          {error && <p role="alert">{error}</p>}
          <textarea readOnly aria-label="Feedback prompt" value={text ?? ""} rows={16} />
          <button type="button" disabled={text === null} onClick={() => void copy()}>
            Copy
          </button>
          {copied && <span role="status"> Copied</span>}
        </>
      )}
    </section>
  );
}
