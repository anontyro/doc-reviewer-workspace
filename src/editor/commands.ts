import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";

/** Wraps each selection in `marker`. With nothing selected it inserts the pair and puts the cursor between. */
const wrap =
  (marker: string): Command =>
  (view) => {
    if (view.state.readOnly) return false;
    view.dispatch(
      view.state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
      })),
    );
    return true;
  };

/** Cmd+B and Cmd+I (F3 spec D17). */
export const formattingKeymap = [
  { key: "Mod-b", run: wrap("**"), preventDefault: true },
  { key: "Mod-i", run: wrap("*"), preventDefault: true },
];
