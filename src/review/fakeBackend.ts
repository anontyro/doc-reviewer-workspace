import type { DraftFile } from "../domain/generated/domain.schema";
import type {
  AnnotationView,
  DocStatus,
  LibraryItem,
  OpenedDocument,
  ProjectView,
  ResolvedAnchor,
} from "../api";

/** What the fake Rust side answers, and every command it was asked. Test support only. */
export function fakeBackend(doc: OpenedDocument) {
  const state = {
    views: [] as AnnotationView[],
    resolve: {
      confidence: "resolved",
      heading_path: ["Title"],
      source_range: { start: 9, end: 19 },
      candidates: 1,
    } as ResolvedAnchor,
    calls: [] as { cmd: string; args: Record<string, unknown> }[],
    /** What `generate_feedback` answers. A function lets a test make it depend on the comments. */
    feedback: (() => "") as () => string,
    /** Commands that reject with this error instead of answering. */
    failWith: null as { kind: string; message: string } | null,
    next: 1,
    /** The recent projects `list_library` answers. */
    library: [] as LibraryItem[],
    /** What a folder or file dialog picks. null means the user cancelled. */
    pick: null as ProjectView | null,
    /** The documents `open_project_document` answers, by relative path. Others answer `doc`. */
    docs: {} as Record<string, OpenedDocument>,
    /** Comments of the documents that are not active. Rust keeps one active document and its comments. */
    parked: {} as Record<string, AnnotationView[]>,
    active: "",
    /** When set, `save_document` rejects with it, as for a file that changed on disk. */
    /** What `check_document` answers. */
    status: { status: "unchanged" } as DocStatus,
    /** The draft `read_draft` answers, and what `save_draft` last stored. */
    draft: null as DraftFile | null,
    saveFails: null as { kind: string; message: string } | null,
  };

  state.feedback = () => `# Review Instructions\n\n${state.views.length} comment(s)\n`;

  const handler = (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, string>;
    state.calls.push({ cmd, args: a });
    if (state.failWith && cmd !== "open_markdown") throw state.failWith;
    switch (cmd) {
      case "open_markdown":
        return doc;
      case "list_library":
        return state.library;
      case "create_project":
      case "open_project":
      case "add_document":
        return state.pick;
      case "open_project_at":
      case "rename_project": {
        const item = state.library.find((i) => i.project_id === a.projectId);
        if (!item) throw { kind: "missing", message: "that project is not in the library" };
        if (cmd === "rename_project") item.name = a.name;
        return { id: item.project_id, name: item.name, root_path: item.root_path, documents: [] };
      }
      case "remove_from_library":
        state.library = state.library.filter((i) => i.project_id !== a.projectId);
        return null;
      case "open_project_document": {
        state.parked[state.active] = state.views;
        state.active = a.relativePath;
        state.views = state.parked[a.relativePath] ?? [];
        return state.docs[a.relativePath] ?? doc;
      }
      case "check_document":
        return state.status;
      case "backup_text":
        return null;
      case "save_draft":
        state.draft = {
          schema_version: "1.0.0",
          document_id: "doc_0123456789abcdef",
          base_hash: a.baseHash,
          text: a.text,
          saved_at: "2026-11-20T10:00:00Z",
        };
        return null;
      case "read_draft":
        return state.draft;
      case "clear_draft":
        state.draft = null;
        return null;
      case "save_document": {
        if (state.saveFails) throw state.saveFails;
        const saved = state.docs[state.active] ?? doc;
        return { ...saved, source: a.text, source_hash: "5".repeat(64), html: `<p>${a.text}</p>` };
      }
      case "resolve_selection":
        return state.resolve;
      case "list_annotations":
        return state.views;
      case "generate_feedback":
        return state.feedback();
      case "create_annotation": {
        const annotation = {
          schema_version: "1.0.0",
          id: `rev_${String(state.next++).padStart(4, "0")}`,
          round_id: "rnd_0001",
          action_type: "comment" as const,
          text: a.text,
          anchor: {
            exact: a.selected,
            prefix: a.prefix,
            suffix: a.suffix,
            heading_path: ["Title"],
            source_range: { start: 9, end: 19 },
            source_hash: doc.source_hash,
            confidence: "resolved" as const,
          },
          status: "open" as const,
          created_at: "2026-11-20T10:00:00Z",
          updated_at: "2026-11-20T10:00:00Z",
        };
        state.views = [...state.views, { annotation, current: state.resolve, stale: false }];
        return annotation;
      }
      case "update_annotation":
        state.views = state.views.map((v) =>
          v.annotation.id === a.id ? { ...v, annotation: { ...v.annotation, text: a.text } } : v,
        );
        return state.views.find((v) => v.annotation.id === a.id)?.annotation;
      case "delete_annotation":
        state.views = state.views.filter((v) => v.annotation.id !== a.id);
        return null;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  };
  return { state, handler };
}
