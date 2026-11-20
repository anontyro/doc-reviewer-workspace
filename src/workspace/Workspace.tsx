import { useEffect, useRef, useState } from "react";
import {
  addDocument,
  openProjectDocument,
  saveDocument,
  type OpenedDocument,
  type ProjectView,
} from "../api";
import SourceEditor from "../editor/SourceEditor";
import Reader from "../reader/Reader";
import { message } from "../project/useLibrary";
import Explorer, { visible } from "./Explorer";
import Tabs from "./Tabs";
import { neighbour, useTabs } from "./useTabs";
import "./workspace.css";

type Props = { onHome: () => void } & (
  { project: ProjectView; quickDoc?: undefined } | { project?: undefined; quickDoc: OpenedDocument }
);

const SAVE_FIRST = "Save first: comments attach to the saved text";

/**
 * A project's documents in an explorer and tabs, or one Quick Open file. Rust holds the single active document, so
 * every activation asks it to re-read the file, and the comment panel reloads with it (F3 spec D14, D15).
 * Each tab is shown rendered or as source. Unsaved text lives here, per tab, until it is saved or discarded (D19).
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
  // Asks before unsaved text is thrown away: closing a tab, or leaving the project.
  const [discarding, setDiscarding] = useState<{ what: string; run: () => void } | null>(null);
  const { tabs, edits, modes, add, remove, setEdit, setMode } = useTabs();
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

  const key = current?.path ?? ""; // the key of the active tab's view and unsaved text
  const edit = edits[key];
  const mode = modes[key] ?? "rendered";

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

  const closeTab = (path: string) => {
    const next = neighbour(tabs, path);
    remove(path);
    if (path !== current?.path) return;
    if (next) void activate(next);
    else {
      latest.current++;
      setCurrent(null);
    }
  };

  const close = (path: string) =>
    edits[path]
      ? setDiscarding({ what: names.get(path) ?? path, run: () => closeTab(path) })
      : closeTab(path);

  const leave = () =>
    Object.keys(edits).length > 0 ? setDiscarding({ what: "your project", run: onHome }) : onHome();

  const addToProject = async () => {
    try {
      const updated = await addDocument();
      if (updated) setDocuments(updated.documents); // cancelled: nothing changes
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  /** Saves the active tab's text. On any error the text and the unsaved marker stay (F3 spec D23). */
  const save = async () => {
    if (!current || !edit) return;
    try {
      const saved = await saveDocument(edit.text, edit.base);
      setEdit(key, null);
      setCurrent({ ...current, doc: saved });
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const typed = (text: string) => {
    if (!current) return;
    setEdit(
      key,
      text === current.doc.source ? null : { text, base: edit?.base ?? current.doc.source_hash },
    );
  };

  const names = new Map(documents.map((d) => [d.relative_path, d.name]));
  const isProject = project !== undefined;

  return (
    <div className="workspace">
      <header className="workspace-bar">
        <button type="button" onClick={leave}>
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
      {discarding && (
        <div role="alertdialog" aria-label="Unsaved changes" className="confirm">
          <p>Unsaved changes in {discarding.what} will be lost.</p>
          <button type="button" autoFocus onClick={() => setDiscarding(null)}>
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => {
              const { run } = discarding;
              setDiscarding(null);
              run();
            }}
          >
            Discard changes
          </button>
        </div>
      )}
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
              tabs={tabs.map((path) => ({
                path,
                name: names.get(path) ?? path,
                dirty: path in edits,
              }))}
              active={current?.path ?? null}
              onSelect={(p) => void activate(p)}
              onClose={close}
            />
          )}
          {current && (
            <div role="group" aria-label="View" className="view-toggle">
              <button
                type="button"
                aria-pressed={mode === "rendered"}
                onClick={() => setMode(key, "rendered")}
              >
                Rendered
              </button>
              <button
                type="button"
                aria-pressed={mode === "source"}
                onClick={() => setMode(key, "source")}
              >
                Source
              </button>
              {mode === "source" && (
                <button type="button" disabled={!edit} onClick={() => void save()}>
                  Save
                </button>
              )}
            </div>
          )}
          {current && mode === "rendered" && edit && (
            <p role="status" className="banner">
              You have unsaved edits. This view shows the last saved text. {SAVE_FIRST}.
            </p>
          )}
          {current && mode === "source" ? (
            <SourceEditor
              key={current.n}
              initial={edit?.text ?? current.doc.source}
              onChange={typed}
              onSave={() => void save()}
            />
          ) : current ? (
            <Reader
              key={current.n}
              doc={current.doc}
              sidebar={sidebar}
              commentsLocked={edit ? SAVE_FIRST : undefined}
            />
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
