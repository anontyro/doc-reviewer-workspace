import { useEffect, useRef, useState } from "react";
import {
  addDocument,
  backupText,
  checkDocument,
  clearDraft,
  CommandError,
  message,
  openProjectDocument,
  readDraft,
  saveDocument,
  saveDraft,
  type DocStatus,
  type OpenedDocument,
  type ProjectView,
} from "../api";
import type { DraftFile } from "../domain/generated/domain.schema";
import SourceEditor from "../editor/SourceEditor";
import Reader from "../reader/Reader";
import Explorer, { visible } from "./Explorer";
import Tabs from "./Tabs";
import Conflict from "./Conflict";
import Recovery from "./Recovery";
import { useChangeCheck } from "./useChangeCheck";
import { neighbour, useTabs } from "./useTabs";
import "./workspace.css";

type Props = { onHome: () => void } & (
  { project: ProjectView; quickDoc?: undefined } | { project?: undefined; quickDoc: OpenedDocument }
);

/** Wait this long after the last keystroke before the unsaved text is written to a draft (F3 spec D27). */
const DRAFT_DELAY_MS = 2000;

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
  const [discarding, setDiscarding] = useState<{
    what: string;
    run: () => void | Promise<void>;
  } | null>(null);
  // What the active file looks like on disk now, when it is not what was read (F3 spec D24).
  const [disk, setDisk] = useState<Exclude<DocStatus, { status: "unchanged" }> | null>(null);
  const [conflict, setConflict] = useState<{ diskHash: string } | null>(null);
  const [recover, setRecover] = useState<{ n: number; draft: DraftFile } | null>(null);
  const { tabs, edits, modes, add, remove, setEdit, setMode } = useTabs();
  const latest = useRef(0); // the newest activation, so a slow answer for an earlier click is dropped
  const dismissed = useRef<string | null>(null); // a disk version the user chose to keep editing past

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

  // While the text is unsaved it is written to a draft shortly after the last keystroke, and never while it is saved.
  const draftText = edit?.text;
  const draftBase = edit?.base;
  const draftDoc = current?.doc.document_id;
  useEffect(() => {
    if (draftText === undefined || draftBase === undefined || draftDoc === undefined) return;
    const timer = setTimeout(() => {
      saveDraft(draftDoc, draftText, draftBase).catch((e) => {
        // `invalid` means the user already moved to another document, which holds its own draft.
        if (!(e instanceof CommandError && e.kind === "invalid")) setError(message(e));
      });
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftText, draftBase, draftDoc]);

  // A Quick Open file is already active, so look for its draft once.
  useEffect(() => {
    if (!quickDoc) return;
    let live = true;
    readDraft(quickDoc.document_id).then(
      (d) => live && d && d.text !== quickDoc.source && setRecover({ n: 0, draft: d }),
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [quickDoc]);

  /** `asked` is true when the user tried to save, which always shows the dialog even past a Keep editing. */
  const openConflict = (s: DocStatus, asked: boolean) => {
    if (s.status === "missing") return setDisk(s);
    // The file differs from the text this edit started from, so the dialog's Overwrite expects this hash.
    const diskHash = s.status === "changed" ? s.disk_hash : (current?.doc.source_hash ?? "");
    if (!asked && dismissed.current === diskHash) return;
    setConflict({ diskHash });
  };

  /** Asks Rust whether the active file still has the bytes that were read. */
  const runCheck = async () => {
    if (!current) return;
    try {
      const s = await checkDocument();
      if (current.n !== latest.current) return; // another document is active now
      if (s.status === "unchanged") return setDisk(null);
      setDisk(s);
      if (s.status === "changed" && edit) openConflict(s, false);
    } catch {
      // A failed check changes nothing. The save will report any real problem.
    }
  };
  useChangeCheck(() => void runCheck());

  const activate = async (path: string) => {
    const mine = ++latest.current;
    try {
      const doc = await openProjectDocument(path);
      if (mine !== latest.current) return;
      add(path);
      setCurrent({ path, doc, n: mine });
      setDisk(null);
      setConflict(null);
      setRecover(null);
      dismissed.current = null;
      setError(null);
      await offerDraft(doc, path, mine);
    } catch (e) {
      if (mine === latest.current) setError(message(e));
    }
  };

  /** Looks for unsaved text left by an earlier session. A tab that already has unsaved text in memory keeps that. */
  const offerDraft = async (doc: OpenedDocument, path: string, n: number) => {
    try {
      const draft = await readDraft(doc.document_id);
      if (n !== latest.current || !draft || edits[path]) return;
      if (draft.text === doc.source)
        await clearDraft(doc.document_id); // nothing to restore
      else setRecover({ n, draft });
    } catch (e) {
      if (n === latest.current) setError(message(e)); // a draft that cannot be read stays where it is
    }
  };

  /** Deletes the drafts of these tabs. Rust holds one active document, so other tabs are made active first. */
  const dropDrafts = async (paths: string[], backToCurrent: boolean) => {
    try {
      let moved = false;
      for (const p of paths) {
        if (p !== key) {
          const other = await openProjectDocument(p);
          moved = true;
          await clearDraft(other.document_id);
        } else if (current) await clearDraft(current.doc.document_id);
      }
      if (moved && backToCurrent && current?.path) await activate(current.path);
    } catch (e) {
      setError(message(e));
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
      ? setDiscarding({
          what: names.get(path) ?? path,
          run: async () => {
            await dropDrafts([path], true);
            closeTab(path);
          },
        })
      : closeTab(path);

  const leave = () =>
    Object.keys(edits).length > 0
      ? setDiscarding({
          what: "your project",
          run: async () => {
            await dropDrafts(Object.keys(edits), false);
            onHome();
          },
        })
      : onHome();

  const addToProject = async () => {
    try {
      const updated = await addDocument();
      if (updated) setDocuments(updated.documents); // cancelled: nothing changes
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  /** The save is done: the text is the file, so the unsaved marker, the draft and any dialog go away. */
  const saved = async (doc: OpenedDocument) => {
    setEdit(key, null);
    setCurrent((c) => (c && c.path === current?.path ? { ...c, doc } : c));
    setDisk(null);
    setConflict(null);
    dismissed.current = null;
    setError(null);
    try {
      await clearDraft(doc.document_id);
    } catch (e) {
      setError(message(e));
    }
  };

  /** A refused save keeps the text and the marker. A changed file opens the conflict dialog (F3 spec D25). */
  const refused = async (e: unknown) => {
    if (e instanceof CommandError && e.kind === "missing") return setDisk({ status: "missing" });
    if (e instanceof CommandError && e.kind === "conflict") {
      try {
        return openConflict(await checkDocument(), true);
      } catch {
        // fall through to show the original message
      }
    }
    setError(message(e));
  };

  /** Saves the tab's text (the editor passes its latest), unless the file changed or is gone. */
  const save = async (latest?: string) => {
    const text = latest ?? edit?.text;
    if (!current || text === undefined || (!edit && text === current.doc.source)) return;
    try {
      const status = await checkDocument(); // just before a save (F3 spec D24)
      if (status.status !== "unchanged") {
        if (status.status === "changed") setDisk(status);
        return openConflict(status, true);
      }
      setDisk(null); // the file is there again if it had been reported missing
      await saved(await saveDocument(text, edit?.base ?? current.doc.source_hash));
    } catch (e) {
      await refused(e);
    }
  };

  /** Only called from the second confirmation. It saves over the disk version, which is backed up first. */
  const overwrite = async () => {
    if (!conflict || !edit) return;
    try {
      await saved(await saveDocument(edit.text, conflict.diskHash));
    } catch (e) {
      await refused(e);
    }
  };

  /** Keeps the user's text as a backup, then shows the file as it is on disk. */
  const loadDisk = async () => {
    if (!edit || current?.path == null) return;
    try {
      await backupText(edit.text);
      await clearDraft(current.doc.document_id);
    } catch (e) {
      return setError(message(e)); // the text is not backed up, so keep it in the editor
    }
    setEdit(key, null);
    setConflict(null);
    await activate(current.path);
  };

  const restore = () => {
    if (!recover) return;
    setEdit(key, { text: recover.draft.text, base: recover.draft.base_hash });
    setMode(key, "source");
    setRecover(null);
  };

  const discardDraft = async () => {
    const id = recover?.draft.document_id;
    setRecover(null);
    try {
      if (id) await clearDraft(id);
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
      {conflict && edit && (
        <Conflict
          key={conflict.diskHash}
          canLoad={current?.path != null}
          onKeep={() => {
            dismissed.current = conflict.diskHash;
            setConflict(null);
          }}
          onLoad={() => void loadDisk()}
          onOverwrite={() => void overwrite()}
        />
      )}
      {recover && current && recover.n === current.n && (
        <Recovery
          name={current.doc.name}
          draft={recover.draft}
          onRestore={restore}
          onDiscard={() => void discardDraft()}
        />
      )}
      {disk?.status === "missing" && (
        <p role="status" className="banner">
          {current?.doc.name} is no longer where it was ({current?.doc.path}). Saving is off. Your
          text stays here.{" "}
          <button type="button" onClick={() => void runCheck()}>
            Check again
          </button>
        </p>
      )}
      {disk?.status === "changed" && !edit && (
        <p role="status" className="banner">
          {current?.doc.name} changed on disk.{" "}
          {current?.path != null ? (
            <button type="button" onClick={() => void activate(current.path!)}>
              Reload
            </button>
          ) : (
            "Open it again from the home screen to see the new text."
          )}
        </p>
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
                <button
                  type="button"
                  disabled={!edit || disk?.status === "missing"}
                  onClick={() => void save()}
                >
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
              onSave={(text) => void save(text)}
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
