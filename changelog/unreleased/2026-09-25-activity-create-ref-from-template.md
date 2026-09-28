# Make a ref from the product's template, deciding about each asset

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

An author could make a new ref from the product's template (its canonical ref, marked stable) in
one pass. **New ref** in the activity header opened a page that took a number (the next free one
filled in) and an optional name, and listed every image and narration of the template in one
language, grouped by the scene that first uses it. For each one the author chose **Keep**,
**Regenerate** (with an edited script or description), **Upload** (a replacement file) or
**Library** (one of the template's uploads). **Keep all**, **Regenerate all images** and **Voice
for all narration** changed every row at once. **Create ref** made the ref, stored and bound the
uploaded files, and started a speech and images run of the new ref for whatever was marked to
regenerate.

## Details

- New route `POST /api/projects/:projectId/activities/:activityId/refs` (project owners) with
  `{ refNum, displayName?, decisions }`, where `:activityId` is the template. Each decision names
  a `language` and `assetKey` and an `action`: `keep`, `clear` (unbinds the asset, with an
  optional new `script`, `description` or narration `voice`) or `bind` (a `media/uploads/...`
  file of the template). It answered `201` with the new ref.
- The new ref got the template's description, specification and media plan, with the manifest
  addressed to the new number, and copies of the template's generated audio and images, uploads
  and implementation features. Media in the WAF checkout stayed shared by path. Module document
  edits were not copied; the assessment stays shared by every ref.
- Refused with `not_canonical` for a ref that is not the product's template, `template_not_stable`
  (naming the ref) when the template is not marked stable, `activity_exists` or
  `activity_archived` for a number the product holds, and `ref_plan_invalid` for a decision
  naming an asset or upload the template lacks, text out of bounds, or an upload of the wrong
  kind. A failure after the ref existed removed its row and its files again.
- New route `GET /api/projects/:projectId/activities/:activityId/refs/next-number` returned
  `{ refNum, canonical, taken }`: the next free number, whether this ref is the template, and
  every number the product's refs hold, deleted ones included.
- Run all stages took `stage: "assets"`: the Speech step, then the Images step.
- A generated narration kept from the template played in the new ref although the run that made
  it belongs to the template.
- The page blocked **Create ref** without a number, with a number the product holds, with an
  upload row without a file, a library row without a pick, or a regenerate row without text or
  over 5000 characters, and listed each reason. When the template was not stable it said so and
  offered **Mark stable**.

## Compatibility

Nothing stored changed: a new ref is an ordinary activity row and draft. The `assets` stage and
the two routes are additive; an older server answers them as unknown.
