import type { ProjectView } from "../api";

interface Props {
  documents: ProjectView["documents"];
  active: string | null;
  open: string[];
  onSelect: (path: string) => void;
  onAdd: () => void;
}

/** Dot-files and temp files are never documents the user added. */
export const visible = (documents: ProjectView["documents"]) =>
  documents.filter((d) => !d.name.startsWith(".") && !d.relative_path.startsWith("."));

/** The project's documents and the Add document button (F3 spec D13). */
export default function Explorer({ documents, active, open, onSelect, onAdd }: Props) {
  const shown = visible(documents);
  return (
    <nav aria-label="Documents">
      {shown.length === 0 ? (
        <p>No documents yet.</p>
      ) : (
        <ul className="explorer">
          {shown.map((d) => (
            <li key={d.relative_path}>
              <button
                type="button"
                aria-current={d.relative_path === active ? "true" : undefined}
                className={open.includes(d.relative_path) ? "is-open" : undefined}
                onClick={() => onSelect(d.relative_path)}
              >
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onAdd}>
        Add document
      </button>
    </nav>
  );
}
