import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { formattingKeymap } from "./commands";
import { detectEndings } from "./lineEndings";
import "./editor.css";

interface Props {
  /** The text to start from. Read once: the editor owns its text after that. */
  initial: string;
  onChange: (text: string) => void;
  /** Called with the editor's current text, so a save right after typing never uses older text. */
  onSave: (text: string) => void;
}

/** Above this many characters, copying the whole text on every keystroke gets slow, so changes are reported after a pause. */
const LARGE = 1_000_000;
const PAUSE_MS = 300;

/** The Markdown source editor (CodeMirror 6, F3 spec D17). Text is held exactly as the file has it (D20). */
export default function SourceEditor({ initial, onChange, onSave }: Props) {
  const [start] = useState(initial);
  const { separator, readOnlyReason } = detectEndings(start);
  const host = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onChange, onSave });
  useEffect(() => {
    callbacks.current = { onChange, onSave };
  });

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: start,
        extensions: [
          EditorState.lineSeparator.of(separator),
          EditorState.readOnly.of(readOnlyReason !== null),
          EditorView.editable.of(readOnlyReason === null),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Markdown source" }),
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          search({ top: true }),
          keymap.of([
            {
              key: "Mod-s",
              run: (v) => {
                if (pending.current) clearTimeout(pending.current);
                pending.current = null;
                const text = v.state.sliceDoc();
                callbacks.current.onChange(text);
                callbacks.current.onSave(text);
                return true;
              },
              preventDefault: true,
            },
            ...formattingKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          // sliceDoc joins lines with the file's own separator, so the text sent to Rust is the file's text.
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (u.state.doc.length <= LARGE) return callbacks.current.onChange(u.state.sliceDoc());
            if (pending.current) clearTimeout(pending.current);
            pending.current = setTimeout(() => {
              pending.current = null;
              callbacks.current.onChange(u.view.state.sliceDoc());
            }, PAUSE_MS);
          }),
        ],
      }),
    });
    return () => {
      if (pending.current) {
        // Switching view before the pause ends must not lose what was typed.
        clearTimeout(pending.current);
        pending.current = null;
        callbacks.current.onChange(view.state.sliceDoc());
      }
      view.destroy();
    };
  }, [start, separator, readOnlyReason]);

  return (
    <div className="source-editor">
      {readOnlyReason && <p role="note">{readOnlyReason}</p>}
      <div ref={host} />
    </div>
  );
}
