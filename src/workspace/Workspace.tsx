import { useEffect, useRef, useState } from "react";
import { addDocument, openProjectDocument, type OpenedDocument, type ProjectView } from "../api";
import Reader from "../reader/Reader";
import { message } from "../project/useLibrary";
import Explorer, { visible } from "./Explorer";
import Tabs from "./Tabs";
import { neighbour, useTabs } from "./useTabs";
import "./workspace.css";

type Props = { onHome: () => void } & (
  { project: ProjectView; quickDoc?: undefined } | { project?: undefined; quickDoc: OpenedDocument }
);

/**
 * A project's documents in an explorer and tabs, or one Quick Open file. Rust holds the single active document, so
 * every activation asks it to re-read the file, and the comment panel reloads with it (F3 spec D14, D15).
 */
export default function Workspace({ project, quickDoc, onHome }: Props) {
  const [documents, setDocuments] = useState(project?.documents ?? []);
  // `n` changes on every activation, so the reader and its comments start fresh even for the same file.
  const [current, setCurrent] = useState<{
    path: string | null;
    doc: OpenedDocument;
    n: number;
  } | null>(quickDoc ? { path: null, doc: quickDoc, n: 0 } : null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [sidebar, setSidebar] = useState<HTMLElement | null>(null);
  const { tabs, add, remove } = useTabs();
  const latest = useRef(0); // the newest activation, so a slow answer for an earlier click is dropped

  useEffect(() => {
    // Cmd+\ toggles the explorer, Cmd+Shift+\ the right sidebar.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.code !== "Backslash") return;
      e.preventDefault();
      (e.shiftKey ? setRight : setLeft)((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activate = async (path: string) => {
    const mine = ++latest.current;
    try {
      const doc = await openProjectDocument(path);
      if (mine !== latest.current) return;
      add(path);
      setCurrent({ path, doc, n: mine });
      setError(null);
    } catch (e) {
      if (mine === latest.current) setError(message(e));
    }
  };

  const close = (path: string) => {
    const next = neighbour(tabs, path);
    remove(path);
    if (path !== current?.path) return;
    if (next) void activate(next);
    else {
      latest.current++;
      setCurrent(null);
    }
  };

  const addToProject = async () => {
    try {
      const updated = await addDocument();
      if (updated) setDocuments(updated.documents); // cancelled: nothing changes
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const names = new Map(documents.map((d) => [d.relative_path, d.name]));
  const isProject = project !== undefined;

  return (
    <div className="workspace">
      <header className="workspace-bar">
        <button type="button" onClick={onHome}>
          Back to projects
        </button>
        <h2 tabIndex={-1}>{isProject ? project.name : "Quick open"}</h2>
        {!isProject && <span className="not-in-project">Not in a project: {quickDoc.name}</span>}
        {isProject && (
          <button
            type="button"
            aria-expanded={left}
            aria-controls="workspace-left"
            onClick={() => setLeft(!left)}
          >
            {left ? "Hide documents" : "Show documents"}
          </button>
        )}
        <button
          type="button"
          aria-expanded={right}
          aria-controls="workspace-right"
          onClick={() => setRight(!right)}
        >
          {right ? "Hide review panel" : "Show review panel"}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div
        className={`workspace-body${left && isProject ? "" : " no-left"}${right ? "" : " no-right"}`}
      >
        {isProject && (
          <aside id="workspace-left" hidden={!left} aria-label="Project documents">
            <Explorer
              documents={documents}
              active={current?.path ?? null}
              open={tabs}
              onSelect={(p) => void activate(p)}
              onAdd={() => void addToProject()}
            />
          </aside>
        )}
        <div className="workspace-centre">
          {isProject && (
            <Tabs
              tabs={tabs.map((path) => ({ path, name: names.get(path) ?? path }))}
              active={current?.path ?? null}
              onSelect={(p) => void activate(p)}
              onClose={close}
            />
          )}
          {current ? (
            <Reader key={current.n} doc={current.doc} sidebar={sidebar} />
          ) : (
            <p className="empty">
              {visible(documents).length === 0
                ? "Add a Markdown document to start."
                : "Select a document to open it."}
            </p>
          )}
        </div>
        {/* Always mounted, so collapsing keeps the reader and its scroll position. */}
        <aside
          id="workspace-right"
          hidden={!right}
          aria-label="Comments and export"
          ref={setSidebar}
        />
      </div>
    </div>
  );
}
