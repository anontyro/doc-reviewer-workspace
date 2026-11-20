import { useCallback, useEffect, useState } from "react";
import { listLibrary, type LibraryItem } from "../api";

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "5 minutes ago" for an RFC 3339 time. Older than a month, or unreadable, shows the date part. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso.slice(0, 10);
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 60 * 24) return plural(Math.floor(minutes / 60), "hour");
  if (minutes < 60 * 24 * 30) return plural(Math.floor(minutes / (60 * 24)), "day");
  return iso.slice(0, 10);
}

/** The recent projects. Rust owns the list and its order, so the shown list is always what Rust last returned. */
export function useLibrary() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      listLibrary().then(
        (list) => {
          setItems(list);
          setError(null);
        },
        (e) => setError(message(e)),
      ),
    [],
  );

  // setState only runs in the promise callbacks, after the screen has rendered.
  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, error, setError, reload };
}
