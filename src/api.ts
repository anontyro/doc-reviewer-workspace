import { invoke } from "@tauri-apps/api/core";
import type { Annotation, DraftFile } from "./domain/generated/domain.schema";

// shortcut: these shapes mirror the Rust structs by hand. Generate them from Rust if they drift.
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

/** Every `ErrorKind` Rust can return. A test compares this list with the Rust enum (F3 spec D10). */
export const ERROR_KINDS = [
  "no_document",
  "not_utf8",
  "too_large",
  "io",
  "invalid",
  "exists",
  "not_project",
  "missing",
  "conflict",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

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

/** A project and its documents (F3 spec D5). */
export interface ProjectView {
  id: string;
  name: string;
  root_path: string;
  documents: { relative_path: string; name: string }[];
}

/** One project in the library. `missing` means its folder is not where it was (F3 spec D4). */
export interface LibraryItem {
  project_id: string;
  name: string;
  root_path: string;
  last_opened_at: string;
  missing: boolean;
}

// Tauri turns a Rust argument `project_id` into `projectId` on the JS side, so arguments below are camelCase.

/** Shows a folder dialog and makes a project there. Resolves to null when the user cancels. */
export const createProject = (name: string) => call<ProjectView | null>("create_project", { name });
/** Shows a folder dialog and opens the project in it. Resolves to null when the user cancels. */
export const openProject = () => call<ProjectView | null>("open_project");
export const openProjectAt = (projectId: string) =>
  call<ProjectView>("open_project_at", { projectId });
export const listLibrary = () => call<LibraryItem[]>("list_library");
export const renameProject = (projectId: string, name: string) =>
  call<ProjectView>("rename_project", { projectId, name });
/** Forgets the project in the library. Nothing on disk is deleted (F3 spec D8). */
export const removeFromLibrary = (projectId: string) =>
  call<null>("remove_from_library", { projectId });
/** Shows a file dialog and copies a Markdown file into the open project. Resolves to null when cancelled. */
export const addDocument = () => call<ProjectView | null>("add_document");
/** Reads the file fresh from disk and makes it the active document (F3 spec D14). */
export const openProjectDocument = (relativePath: string) =>
  call<OpenedDocument>("open_project_document", { relativePath });
/** Saves text over the active file, or rejects with `conflict` if the file changed since `expectedHash` (F3 spec D21). */
export const saveDocument = (text: string, expectedHash: string) =>
  call<OpenedDocument>("save_document", { text, expectedHash });

/** What is on disk compared with what the app read (F3 spec D24). */
export type DocStatus =
  { status: "unchanged" } | { status: "changed"; disk_hash: string } | { status: "missing" };

export const checkDocument = () => call<DocStatus>("check_document");
/** Keeps the user's unsaved text as a backup, before they load the disk version (F3 spec D25). */
export const backupText = (text: string) => call<null>("backup_text", { text });
export const saveDraft = (text: string, baseHash: string) =>
  call<null>("save_draft", { text, baseHash });
export const readDraft = () => call<DraftFile | null>("read_draft");
export const clearDraft = () => call<null>("clear_draft");

/** Shows the native dialog. Resolves to null when the user cancels. */
export const openMarkdown = () => call<OpenedDocument | null>("open_markdown");

export const resolveSelection = (selected: string, prefix: string, suffix: string) =>
  call<ResolvedAnchor>("resolve_selection", { selected, prefix, suffix });

/** A saved comment and how it stands against the open text now (F2 spec D20). */
export interface AnnotationView {
  annotation: Annotation;
  /** A fresh resolution of the stored quote. Nothing is saved from it. */
  current: ResolvedAnchor;
  /** The comment was made on a different version of the file. */
  stale: boolean;
}

export const createAnnotation = (
  c: { selected: string; prefix: string; suffix: string },
  text: string,
) => call<Annotation>("create_annotation", { ...c, text });
export const listAnnotations = () => call<AnnotationView[]>("list_annotations");
export const updateAnnotation = (id: string, text: string) =>
  call<Annotation>("update_annotation", { id, text });
export const deleteAnnotation = (id: string) => call<null>("delete_annotation", { id });

/** The exact feedback prompt for the open document: what the export panel shows and copies (F2 spec D25). */
export const generateFeedback = () => call<string>("generate_feedback");
