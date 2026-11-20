import { useState } from "react";

/** The tab to show after `path` is closed: the one on its right, else the one on its left, else none. */
export function neighbour(tabs: string[], path: string): string | null {
  const i = tabs.indexOf(path);
  return tabs[i + 1] ?? tabs[i - 1] ?? null;
}

/** The open tabs, in the order they were opened. A tab is a project document's relative path. */
export function useTabs() {
  const [tabs, setTabs] = useState<string[]>([]);
  return {
    tabs,
    add: (path: string) => setTabs((t) => (t.includes(path) ? t : [...t, path])),
    remove: (path: string) => setTabs((t) => t.filter((p) => p !== path)),
  };
}
