import { useEffect, useRef, useState } from "react";
import type { ProjectView } from "./api";
import Home from "./project/Home";
import Reader from "./reader/Reader";

type View = { kind: "home" } | { kind: "quick" } | { kind: "project"; project: ProjectView };

/** Two states, home and a document view, held in React state. No router (F3 spec D12). */
export default function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const main = useRef<HTMLElement>(null);

  // The window title and keyboard focus follow the view, so a screen reader announces the change.
  useEffect(() => {
    document.title =
      view.kind === "project"
        ? `${view.project.name} · LLM Review Workspace`
        : view.kind === "quick"
          ? "Quick open · LLM Review Workspace"
          : "LLM Review Workspace";
    main.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [view]);

  const home = () => setView({ kind: "home" });

  return (
    <main ref={main}>
      <h1>LLM Review Workspace</h1>
      {view.kind === "home" && (
        <Home
          onOpenProject={(project) => setView({ kind: "project", project })}
          onQuickOpen={() => setView({ kind: "quick" })}
        />
      )}
      {view.kind === "quick" && (
        <>
          <h2 tabIndex={-1}>Quick open</h2>
          <button type="button" onClick={home}>
            Back to projects
          </button>
          <Reader />
        </>
      )}
      {view.kind === "project" && (
        // shortcut: a plain list until the workspace (explorer, tabs) lands in F3 P4.
        <section>
          <h2 tabIndex={-1}>{view.project.name}</h2>
          <p>{view.project.root_path}</p>
          <button type="button" onClick={home}>
            Back to projects
          </button>
          <ul>
            {view.project.documents.map((d) => (
              <li key={d.relative_path}>{d.name}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
