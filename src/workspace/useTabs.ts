import { useState } from "react";

/** The tab to show after `path` is closed: the one on its right, else the one on its left, else none. */
export function neighbour(tabs: string[], path: string): string | null {
  const i = tabs.indexOf(path);
  return tabs[i + 1] ?? tabs[i - 1] ?? null;
}

/** Unsaved text of a tab, and the `source_hash` of the file it was loaded from. */
export interface Edit {
  text: string;
  base: string;
}

export type Mode = "rendered" | "source";

/**
 * The open tabs, in the order they were opened (a tab is a project document's relative path), and each tab's view
 * and unsaved text. A Quick Open file has no tab and uses the key "".
 */
export function useTabs() {
  const [tabs, setTabs] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const without = <T>(map: Record<string, T>, key: string) =>
    Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
  return {
    tabs,
    edits,
    modes,
    add: (path: string) => setTabs((t) => (t.includes(path) ? t : [...t, path])),
    remove: (path: string) => {
      setTabs((t) => t.filter((p) => p !== path));
      setEdits((e) => without(e, path));
      setModes((m) => without(m, path));
    },
    /** Sets a tab's unsaved text, or clears it with null. */
    setEdit: (key: string, edit: Edit | null) =>
      setEdits((e) => (edit ? { ...e, [key]: edit } : without(e, key))),
    setMode: (key: string, mode: Mode) => setModes((m) => ({ ...m, [key]: mode })),
  };
}
