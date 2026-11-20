import { useState } from "react";

interface Props {
  /** Load the disk version needs the tab to be re-read, which a Quick Open file cannot do. */
  canLoad: boolean;
  onKeep: () => void;
  onLoad: () => void;
  onOverwrite: () => void;
}

/**
 * The file on disk changed while the tab has unsaved text (F3 spec D25). Keep editing is the default and writes
 * nothing. Overwriting needs a second confirmation, so it never happens on one click.
 */
export default function Conflict({ canLoad, onKeep, onLoad, onOverwrite }: Props) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      role="alertdialog"
      aria-label="File changed on disk"
      className="confirm"
      onKeyDown={(e) => e.key === "Escape" && onKeep()}
    >
      {confirming ? (
        <>
          <p>
            Replace the version on disk with your text? The version on disk is kept as a backup
            first.
          </p>
          <button key="keep-confirm" type="button" autoFocus onClick={onKeep}>
            Keep editing
          </button>
          <button type="button" onClick={onOverwrite}>
            Yes, overwrite the disk version
          </button>
        </>
      ) : (
        <>
          <p>This file changed on disk while you were editing. Nothing has been overwritten.</p>
          <button key="keep-first" type="button" autoFocus onClick={onKeep}>
            Keep editing
          </button>
          {canLoad && (
            <button type="button" onClick={onLoad}>
              Load the disk version
            </button>
          )}
          <button type="button" onClick={() => setConfirming(true)}>
            Overwrite the disk version
          </button>
        </>
      )}
    </div>
  );
}
