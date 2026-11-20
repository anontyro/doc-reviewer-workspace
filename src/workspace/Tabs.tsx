import { useRef } from "react";

interface Props {
  tabs: { path: string; name: string }[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

/** The tab strip. Arrow keys move focus between tabs, Enter or Space opens the focused one (F3 spec D14). */
export default function Tabs({ tabs, active, onSelect, onClose }: Props) {
  const list = useRef<HTMLDivElement>(null);

  const move = (e: React.KeyboardEvent) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % buttons.length
        : e.key === "ArrowLeft"
          ? (at - 1 + buttons.length) % buttons.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    buttons[to].focus();
  };

  return (
    <div ref={list} role="tablist" aria-label="Open documents" className="tabs" onKeyDown={move}>
      {tabs.map((t) => (
        <div key={t.path} role="presentation" className={t.path === active ? "tab active" : "tab"}>
          <button
            type="button"
            role="tab"
            aria-selected={t.path === active}
            // Only the selected tab is in the tab order. Arrow keys reach the others.
            tabIndex={t.path === active ? 0 : -1}
            onClick={() => onSelect(t.path)}
          >
            {t.name}
          </button>
          <button type="button" aria-label={`Close ${t.name}`} onClick={() => onClose(t.path)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
