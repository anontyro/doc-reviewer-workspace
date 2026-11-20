import { useEffect, useState } from "react";
import { resolveSelection, type ResolvedAnchor } from "../api";
import type { Capture } from "./capture";
import { refusal } from "./useAnnotations";
import type { Rect, Selected } from "./useSelection";

type State =
  | { mode: "closed" }
  | { mode: "message"; text: string; rect: Rect }
  | { mode: "composer"; capture: Capture; resolved: ResolvedAnchor; rect: Rect; range: Range };

const MENU_HEIGHT = 48;

interface Props {
  selected: Selected;
  onLock: (locked: boolean) => void;
  /** Called when the composer or message closes, with the range to put the selection back on. */
  onClose: (range?: Range) => void;
  onSave: (capture: Capture, text: string) => void;
}

/** The floating Comment menu and its composer (F2 spec D10 to D12). */
export default function FloatingMenu({ selected, onLock, onClose, onSave }: Props) {
  const [state, setState] = useState<State>({ mode: "closed" });
  const [draft, setDraft] = useState("");

  const begin = async () => {
    if (selected.kind === "none") return;
    const rect = selected.kind === "ok" ? selected.rect : { top: 0, bottom: 0, left: 0 };
    onLock(true);
    setDraft("");
    if (selected.kind === "unsupported") {
      return setState({
        mode: "message",
        rect,
        text: "Not supported: select text inside one paragraph, heading or table cell.",
      });
    }
    try {
      const resolved = await resolveSelection(
        selected.capture.selected,
        selected.capture.prefix,
        selected.capture.suffix,
      );
      const why = refusal(resolved);
      setState(
        why
          ? { mode: "message", rect, text: why }
          : { mode: "composer", rect, capture: selected.capture, resolved, range: selected.range },
      );
    } catch (e) {
      setState({ mode: "message", rect, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const close = () => {
    const range =
      state.mode === "composer" ? state.range : selected.kind === "ok" ? selected.range : undefined;
    setState({ mode: "closed" });
    onLock(false);
    onClose(range);
  };

  const save = () => {
    if (state.mode !== "composer" || draft.trim() === "") return;
    onSave(state.capture, draft);
    close();
  };

  // Recommended shortcut, not confirmed (PRD §6.1): Cmd+Shift+M opens the composer for the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "m" && state.mode === "closed") {
        e.preventDefault();
        void begin();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (state.mode === "closed") {
    if (selected.kind !== "ok") return null;
    return (
      <div
        className="floating"
        role="toolbar"
        aria-label="Review actions"
        style={position(selected.rect)}
      >
        {/* mousedown must not take focus, or the document selection is lost before the click lands */}
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void begin()}>
          Comment
        </button>
      </div>
    );
  }

  const onBoxKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      className="floating composer"
      role="dialog"
      aria-label="Add comment"
      style={position(state.rect)}
      onKeyDown={onBoxKey}
    >
      {state.mode === "message" ? (
        <>
          <p role="alert">{state.text}</p>
          <button type="button" autoFocus onClick={close}>
            Close
          </button>
        </>
      ) : (
        <>
          <textarea
            autoFocus
            aria-label="Comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="button" disabled={draft.trim() === ""} onClick={save}>
            Save (⌘↵)
          </button>
          <button type="button" onClick={close}>
            Cancel (Esc)
          </button>
        </>
      )}
    </div>
  );
}

/** Below the selection, or above it when there is no room, so the selected text is never covered. */
function position(rect: Rect): React.CSSProperties {
  const below = rect.bottom + 8 + MENU_HEIGHT <= window.innerHeight;
  return below
    ? { position: "fixed", top: rect.bottom + 8, left: rect.left }
    : { position: "fixed", top: rect.top - 8, left: rect.left, transform: "translateY(-100%)" };
}
