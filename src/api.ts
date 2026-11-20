import { invoke } from "@tauri-apps/api/core";

// shortcut: these shapes mirror the Rust structs by hand. Generate them from Rust when the command set grows (F3).
export interface OpenedDocument {
  path: string;
  name: string;
  document_id: string;
  version_id: string;
  source_hash: string;
  source: string;
  html: string;
}

export interface ResolvedAnchor {
  confidence: "resolved" | "ambiguous" | "orphaned";
  heading_path: string[] | null;
  /** UTF-8 byte offsets, half-open (FoundationSpike decision 0005). */
  source_range: { start: number; end: number } | null;
  candidates: number;
}

export type ErrorKind = "no_document" | "not_utf8" | "too_large" | "io" | "invalid";

/** What every Rust command rejects with (F2 spec D5). */
export class CommandError extends Error {
  constructor(
    readonly kind: ErrorKind | "unknown",
    message: string,
  ) {
    super(message);
  }
}

function toError(e: unknown): CommandError {
  if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
    const { kind, message } = e as { kind: ErrorKind; message: string };
    return new CommandError(kind, message);
  }
  return new CommandError("unknown", String(e));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toError(e);
  }
}

/** Shows the native dialog. Resolves to null when the user cancels. */
export const openMarkdown = () => call<OpenedDocument | null>("open_markdown");

export const resolveSelection = (selected: string, prefix: string, suffix: string) =>
  call<ResolvedAnchor>("resolve_selection", { selected, prefix, suffix });
