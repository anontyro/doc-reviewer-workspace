import { lazy, Suspense } from "react";

// Dev builds only: `import.meta.env.DEV` is replaced at build time, so the production bundle drops the view (spec D18).
const SpikeView = import.meta.env.DEV ? lazy(() => import("./spike/SpikeView")) : null;

export default function App() {
  return (
    <main>
      <h1>LLM Review Workspace</h1>
      {SpikeView && (
        <Suspense fallback={null}>
          <SpikeView />
        </Suspense>
      )}
    </main>
  );
}
