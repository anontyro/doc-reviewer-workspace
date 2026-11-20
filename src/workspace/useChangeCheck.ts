import { useEffect, useRef } from "react";

/** Calls `check` each time the window regains focus, which is when a file edited elsewhere is noticed (F3 spec D24). */
export function useChangeCheck(check: () => void) {
  const latest = useRef(check);
  useEffect(() => {
    latest.current = check;
  });
  useEffect(() => {
    const run = () => latest.current();
    window.addEventListener("focus", run);
    return () => window.removeEventListener("focus", run);
  }, []);
}
