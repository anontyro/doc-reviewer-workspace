import { useEffect, useRef, useState } from "react";
import type { OpenedDocument, ProjectView } from "./api";
import Home from "./project/Home";
import Workspace from "./workspace/Workspace";

type View =
  | { kind: "home" }
  | { kind: "quick"; doc: OpenedDocument }
  | { kind: "project"; project: ProjectView };

/** Two states, home and workspace, held in React state. No router (F3 spec D12). */
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
          onQuickOpen={(doc) => setView({ kind: "quick", doc })}
        />
      )}
      {view.kind === "quick" && <Workspace quickDoc={view.doc} onHome={home} />}
      {view.kind === "project" && <Workspace project={view.project} onHome={home} />}
    </main>
  );
}
