# Implementation features for module assembly

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

Loom's Implementation Features row now opens. It lists patterns that shipped modules
implement well, and a ref can select any of them for its module assembly to reproduce
exactly instead of reinventing them. With it, every row of Loom's hierarchy opens.

## Details

- The catalogue is Loom's: speaker audio choices, freight boxes and conveyor, and
  correct-first final review cards. Each names its source module, the files to read there,
  and the symbols, selectors and style fragments the new module must carry.
- `GET` and `PUT /api/projects/:projectId/activities/:activityId/implementation-features`
  read and save a ref's selection. The selection is kept beside the draft as
  `implementation-features.json`, as Loom keeps it beside the spec. Unknown ids are
  refused.
- A module assembly writes the selected features into its workspace and adds Loom's
  instruction to its prompt. The source files are read from the WAF checkout, which the
  run may read but not change.
- The view lists each feature with a switch that saves at once. The tree's "not produced
  yet" state was removed, since no row needs it any more.
- Importing from Loom carries each ref's selection, read from its
  `implementation_features.json`. Only features in the catalogue are kept, and a ref
  without the file imports with none.
