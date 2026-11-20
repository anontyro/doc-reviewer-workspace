import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Annotation } from "./generated/domain.schema";
import type { ExportManifest } from "./generated/export-manifest.schema";
import { ENTITY_NAMES, validateEntity, type EntityName } from "./validate";

interface Case {
  name: string;
  type: EntityName;
  value: unknown;
}
const load = (f: string) =>
  JSON.parse(
    readFileSync(new URL(`../../fixtures/domain/${f}`, import.meta.url), "utf8"),
  ) as Case[];
const valid = load("valid.json");
const invalid = load("invalid.json");

describe("domain schema validation", () => {
  it.each(valid)("accepts: $name", ({ type, value }) => {
    expect(validateEntity(type, value)).toEqual({ ok: true });
  });

  it.each(invalid)("rejects: $name", ({ type, value }) => {
    const result = validateEntity(type, value);
    expect(result.ok).toBe(false);
  });

  it("has a valid and an invalid case for every entity and the manifest", () => {
    for (const name of [...ENTITY_NAMES, "ExportManifest" as const]) {
      expect(
        valid.map((c) => c.type),
        name,
      ).toContain(name);
      expect(
        invalid.map((c) => c.type),
        name,
      ).toContain(name);
    }
  });

  it("reports which field failed", () => {
    const bad = invalid.find((c) => c.name === "Annotation: anchor missing exact")!;
    const result = validateEntity(bad.type, bad.value);
    expect(result.ok === false && result.errors).toContain("exact");
  });

  it("accepts the file Rust writes for comments and refuses a corrupted one", () => {
    const file = valid.find((c) => c.name === "AnnotationFile valid")!;
    expect(validateEntity("AnnotationFile", file.value)).toEqual({ ok: true });
    const broken = { ...(file.value as object), next_sequence: "3" };
    expect(validateEntity("AnnotationFile", broken).ok).toBe(false);
  });

  it("gives the generated TS types the same shape the validator accepts", () => {
    const annotation = valid.find((c) => c.type === "Annotation")!.value as Annotation;
    expect(annotation.anchor.confidence).toBe("resolved");
    const manifest = valid.find((c) => c.type === "ExportManifest")!.value as ExportManifest;
    expect(manifest.documents[0].annotations[0].target.type).toBe("text_quote");
  });
});
