# 0003 · Persisted data carries its own SemVer `schema_version`, and no incompatible migration runs without a backup

**Status:** Agreed · **Work items:** T-002 · **Spec:** `Docs/FoundationSpike/Specs/2026-11-13-F1-foundation-spike.md` D9

Every persisted root type (`Project`, `Document`, `DocumentVersion`, `ReviewRound`, `Annotation`, `ExportSnapshot`,
`LibraryEntry`, `ExportManifest`) has a `schema_version` field in `MAJOR.MINOR.PATCH` form, starting at `1.0.0`. It is
independent of the app version (PRD §13.2).

- **Check before use.** `check_schema_version` accepts any `1.x.y`. It returns `TooNew` for a higher major, `TooOld` for
  a lower one and `Malformed` for anything that is not three plain numbers, including pre-release suffixes, spaces and
  a leading `v`. A loader must call it before trusting the rest of a file.
- **Minor and patch are additive.** Fields added within a major are optional, and old readers ignore unknown fields.
- **Major changes need a migration.** There is none yet. When one exists it must back up the affected files first,
  never drop historical annotations, and ship with a test that migrates a fixture from the previous major.
- **A newer file is never rewritten.** `TooNew` means the user opens the project with a newer app. The data is left alone.

## Why

Without an explicit version, any later change strands user projects (PRD risk: "project schema changes strand user
data"). Refusing a newer major, instead of reading it best-effort, avoids silently dropping fields on the next save.

## Consequences

- Every new persisted root type must add `schema_version` and a validator case.
- The first migration will add a backup step and a fixture test before it can merge.
