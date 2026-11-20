import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { captureSelection } from "./capture";
import { renderMarkdown } from "./markdown";
import { resolveAnchor } from "./resolve";

// Dev-only spike view (spec D18). Delete with the losing engine in F2.
const files = import.meta.glob("../../fixtures/markdown/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const names = Object.keys(files).map((p) => p.split("/").pop()!);
const sourceOf = (name: string) => files[`../../fixtures/markdown/${name}`];

type Engine = "ts" | "rust";
interface Shown {
  confidence: string;
  headingPath: string[] | null;
  range: string;
  candidates: number;
}

async function resolveWith(
  engine: Engine,
  source: string,
  c: { selected: string; prefix: string; suffix: string },
) {
  if (engine === "ts") {
    const r = resolveAnchor(source, c.selected, c.prefix, c.suffix);
    return { ...r, range: r.range ? `${r.range[0]}..${r.range[1]} (UTF-16)` : "none" };
  }
  const r = await invoke<{
    confidence: string;
    heading_path: string[] | null;
    source_range: { start: number; end: number } | null;
    candidates: number;
  }>("spike_resolve_anchor", { source, ...c });
  return {
    confidence: r.confidence,
    headingPath: r.heading_path,
    range: r.source_range ? `${r.source_range.start}..${r.source_range.end} (UTF-8 bytes)` : "none",
    candidates: r.candidates,
  };
}

export default function SpikeView() {
  const [name, setName] = useState(names[0]);
  const [engine, setEngine] = useState<Engine>("ts");
  const [html, setHtml] = useState("");
  const [shown, setShown] = useState<Shown | string | null>(null);
  const source = sourceOf(name);

  useEffect(() => {
    let stale = false; // a slow earlier Rust call must not overwrite a newer render
    void (async () => {
      try {
        const out =
          engine === "ts"
            ? renderMarkdown(source)
            : await invoke<string>("spike_render_markdown", { source });
        if (!stale) setHtml(out);
      } catch (e) {
        if (stale) return;
        setHtml("");
        setShown(
          `Engine ${engine} unavailable: ${String(e)} (the Rust engine needs pnpm tauri dev)`,
        );
      }
    })();
    return () => {
      stale = true;
    };
  }, [source, engine]);

  const onSelect = async () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const cap = captureSelection(sel.getRangeAt(0));
    if (!cap) return setShown("Not supported: empty selection or one that crosses blocks.");
    try {
      setShown(await resolveWith(engine, source, cap));
    } catch (e) {
      setShown(`Engine ${engine} failed: ${String(e)}`);
    }
  };

  return (
    <section>
      <h2>Source-map spike</h2>
      <select value={name} onChange={(e) => setName(e.target.value)}>
        {names.map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
      <select value={engine} onChange={(e) => setEngine(e.target.value as Engine)}>
        <option value="ts">TypeScript</option>
        <option value="rust">Rust</option>
      </select>
      {/* The pipelines sanitise: engine A with rehype-sanitize, engine B with comrak's safe mode (spec D15). */}
      <div onMouseUp={onSelect} dangerouslySetInnerHTML={{ __html: html }} />
      <pre>
        {typeof shown === "string"
          ? shown
          : shown
            ? JSON.stringify(shown, null, 2)
            : "Select some text."}
      </pre>
    </section>
  );
}
