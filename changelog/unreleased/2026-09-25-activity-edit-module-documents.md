# Edit Configuration Data and Assessment Data

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

An author can now edit **Configuration Data** and **Assessment Data** as JSON and save the
change. The preview and every later assembly use the edited document until the author presses
**Discard edit**. The page says when a document is an edit, and warns when the media plan
(for the configuration) or the specification (for the assessment) has changed since the edit.

- The edit is stored in the activity's draft (`draft.json` under `PENGUIN_HOME`), in a new
  optional `moduleDocuments` field. Nothing is written to the WAF checkout or to a run
  workspace. A draft without edits keeps its current revision.
- New routes for project owners:
  `PUT /api/projects/:projectId/activities/:activityId/module-documents/:kind` with
  `{ value, expectedRevision }`, and `POST .../module-documents/:kind/discard` with
  `{ expectedRevision }`. `kind` is `configuration` or `assessment`. Both return the draft.
- Every ref of a product shares one assessment, so it can be edited only on the canonical ref.
  Other refs get `not_canonical`, see the edit read-only, and use it in their preview.
- A saved assessment must have an `items` list. Single-choice and multiple-response items are
  checked with the preview's assessment rules. A document larger than 1 MB, or one that breaks
  these rules, is refused with `document_invalid`. The message names each problem by the
  item's place in the file, up to five, and counts the rest. A problem the document being
  edited already had does not refuse the save, because many existing modules break these rules;
  only the problems the edit introduces do.
- Renumbering a ref does not make its configuration edit stale.
- `GET .../module-documents` now returns `edited`, `stale` and `editable` for each document,
  plus the product's `canonicalRefNum`. Its `source` is `draft` when an edit exists but no
  module has been assembled yet.
- Assembly writes the edited configuration in place of the generated one, and writes the edited
  assessment to `assessments/<code>-<ref>.json`. After the model's turn, the assembly check
  requires the written files to keep everything the edit says. The assembly may add keys, but
  it may not change or remove the author's values.
- Older builds keep the new draft field when they rewrite a draft, but they leave it out of the
  draft's revision. After a rollback, a draft with an edit shows as an unvalidated draft until it
  is validated again.
