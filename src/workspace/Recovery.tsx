import type { DraftFile } from "../domain/generated/domain.schema";

interface Props {
  name: string;
  draft: DraftFile;
  onRestore: () => void;
  onDiscard: () => void;
}

/** Offered when a document is opened and unsaved text from an earlier session is on disk (F3 spec D27). */
export default function Recovery({ name, draft, onRestore, onDiscard }: Props) {
  return (
    <div role="alertdialog" aria-label="Unsaved text found" className="confirm">
      <p>
        Unsaved text for {name} was found from {draft.saved_at.slice(0, 16).replace("T", " ")}.
        Restore it or discard it?
      </p>
      <button type="button" autoFocus onClick={onRestore}>
        Restore
      </button>
      <button type="button" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}
