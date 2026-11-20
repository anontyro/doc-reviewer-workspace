import Ajv2020 from "ajv/dist/2020";
import domainSchema from "../../schemas/v1/domain.schema.json";
import manifestSchema from "../../schemas/v1/export-manifest.schema.json";

export const ENTITY_NAMES = [
  "Project",
  "Document",
  "DocumentVersion",
  "ReviewRound",
  "Annotation",
  "ExportSnapshot",
  "LibraryEntry",
  "AnnotationFile",
] as const;
export type EntityName = (typeof ENTITY_NAMES)[number] | "ExportManifest";

export type ValidationResult = { ok: true } | { ok: false; errors: string };

const ajv = new Ajv2020({ strict: true, allErrors: true });
// schemars emits these integer formats for Rust u32/u64; the `minimum` keyword already rejects negatives.
ajv.addFormat("uint32", {
  type: "number",
  validate: (n) => Number.isInteger(n) && n <= 0xffffffff,
});
ajv.addFormat("uint64", { type: "number", validate: (n) => Number.isInteger(n) });
ajv.addSchema(domainSchema, "domain");
ajv.addSchema(manifestSchema, "manifest");

/** Validates a value against the schema generated from the Rust type. Use at every file and import boundary. */
export function validateEntity(name: EntityName, value: unknown): ValidationResult {
  const ref = name === "ExportManifest" ? "manifest#" : `domain#/$defs/${name}`;
  const validate = ajv.getSchema(ref);
  if (!validate) throw new Error(`no schema for ${name}`);
  return validate(value) ? { ok: true } : { ok: false, errors: ajv.errorsText(validate.errors) };
}
