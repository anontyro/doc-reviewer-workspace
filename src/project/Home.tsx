import { useState } from "react";
import {
  createProject,
  openMarkdown,
  openProject,
  openProjectAt,
  removeFromLibrary,
  renameProject,
  type LibraryItem,
  type OpenedDocument,
  type ProjectView,
} from "../api";
import { message, timeAgo, useLibrary } from "./useLibrary";

interface Props {
  onOpenProject: (project: ProjectView) => void;
  onQuickOpen: (doc: OpenedDocument) => void;
}

/** The start screen: recent projects and the ways to open something (F3 spec D11). */
export default function Home({ onOpenProject, onQuickOpen }: Props) {
  const { items, error, setError, reload } = useLibrary();
  const [naming, setNaming] = useState<string | null>(null); // the New project form, null when closed
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<LibraryItem | null>(null);

  /** Runs a command. A failure shows as an alert and leaves everything as it was. */
  const run = async (command: () => Promise<void>) => {
    try {
      await command();
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  /** A dialog command resolves to null when the user cancels, and then nothing changes. */
  const enter = (command: () => Promise<ProjectView | null>) =>
    run(async () => {
      const project = await command();
      if (project) onOpenProject(project);
    });

  return (
    <section className="home">
      <h2 tabIndex={-1}>Projects</h2>
      <div className="home-actions">
        <button type="button" onClick={() => setNaming(naming === null ? "" : null)}>
          New project
        </button>
        <button type="button" onClick={() => void enter(openProject)}>
          Open folder
        </button>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              const doc = await openMarkdown(); // null: cancelled
              if (doc) onQuickOpen(doc);
            })
          }
        >
          Quick open
        </button>
      </div>

      {naming !== null && (
        <form
          className="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            void enter(() => createProject(naming));
          }}
        >
          <label>
            Project name
            <input value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
          </label>
          <button type="submit">Choose folder…</button>
          <button type="button" onClick={() => setNaming(null)}>
            Cancel
          </button>
        </form>
      )}

      {error && <p role="alert">{error}</p>}

      {items.length === 0 ? (
        <p className="home-empty">No projects yet. Create one, or open a folder that holds one.</p>
      ) : (
        <ul className="projects">
          {items.map((item) => (
            <li key={item.project_id} className="project-card">
              {renaming?.id === item.project_id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await renameProject(item.project_id, renaming.name);
                      setRenaming(null);
                      await reload();
                    });
                  }}
                >
                  <label>
                    Name
                    <input
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: item.project_id, name: e.target.value })}
                      autoFocus
                    />
                  </label>
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <h3>
                    {item.name}
                    {item.missing && <span className="badge">Folder missing</span>}
                  </h3>
                  <p className="project-path">{item.root_path}</p>
                  <p className="project-opened">Opened {timeAgo(item.last_opened_at)}</p>
                  <div className="project-actions">
                    <button
                      type="button"
                      aria-label={`Open ${item.name}`}
                      onClick={() => void enter(() => openProjectAt(item.project_id))}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${item.name}`}
                      onClick={() => setRenaming({ id: item.project_id, name: item.name })}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => setRemoving(item)}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <div role="alertdialog" aria-label={`Remove ${removing.name}`} className="confirm">
          <p>
            Remove “{removing.name}” from the list? The folder and its files stay on your disk. You
            can open the folder again later.
          </p>
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                await removeFromLibrary(removing.project_id);
                setRemoving(null);
                await reload();
              })
            }
          >
            Remove from list
          </button>
          <button type="button" autoFocus onClick={() => setRemoving(null)}>
            Keep
          </button>
        </div>
      )}
    </section>
  );
}
