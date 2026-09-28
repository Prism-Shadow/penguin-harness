# Delete an activity, and tag products to filter the Activities list

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

An author can delete an activity they no longer want, after confirming, and give products
free-text tags ("grade 1", "phonics", "pilot") that every ref of the product shares. The
Activities list gained a tag filter with counts, and each card shows its product's tags.

## Deleting

- **Ref settings** in the activity header gained a **Delete activity** button. It asks first,
  and on success returns to the Activities list and announces the deletion.
- `DELETE /api/projects/:projectId/activities/:activityId` archives the activity (204): it
  leaves every list and read, and nothing on disk is removed, so its drafts and media stay.
- A delete is refused with 409 while a run is working on the activity (`run_active`), while
  its stages are running (`pipeline_running`), and for a product's canonical ref while other
  live refs of the product remain (`canonical_has_refs`).
- A deleted ref keeps its number: creating that product and ref number again is refused with
  409 `activity_archived`, which the create dialog words as such. The product also keeps its
  canonical number when its canonical ref is deleted: creating another ref does not move the
  module to it.
- Importing a Loom product again reports its deleted refs as deleted, rather than as already
  there, and does not recreate them.

## Tags

- **Ref settings** gained a **Tags** field: add a tag with **Add** or Enter, remove one from
  its chip, and save with the rest of the settings. Tags are trimmed, inner whitespace is
  collapsed, duplicates are dropped ignoring case, and a product holds at most 20 tags of at
  most 32 characters each.
- `PUT /api/projects/:projectId/activities/:activityId/tags` `{ tags }` replaces the tags of
  the activity's product and returns them as stored. Refusals are 400 `tags_too_long`,
  `tags_too_many` or `tags_invalid` (anything else wrong), each worded by the App, and a ref
  with no product is refused with 409 `no_product`.
- Every activity record the API returns carries `tags`.
- Saving a ref's settings refreshes the Activities list, so its cards show new names and
  tags when the author goes back to it.
- The Activities list shows a chip row, **All** plus each tag with its count, above the cards
  whenever any product is tagged. One tag can be chosen at a time, and it narrows the list
  together with the search.

## Stored data

Migration 20 (`activity-product-tags`) added the `activity_product_tags` table. See
[backward compatibility](2026-09-25-backward-compatibility.md).
