# Per-scene asset editing in the activity media workbench

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#28](https://github.com/Prism-Shadow/penguin-harness/pull/28)

The media workbench reached its assets through a flat list of keys. It now reaches them
through the scenes that ask for them, and the bare media-path box was replaced by a
binding editor that validates the path, clears it, and points an asset at a file another
asset already uses.

## Scene tree

The workbench's left rail became a tree of the saved specification's scenes. Each scene
collapses, carries its description and a bound-of-total count, and groups its media into
Images, Audio, Video and Animations categories. General scenes lead the tree; the rest
follow the specification's own order. A row names its asset key, whether it is bound,
whether other scenes share it, and how many times the scene asks for it. Manifest entries
no scene references are listed under their own heading rather than hidden. The media-type
filter narrows the tree and drops the scenes it empties.

## Binding editor

The selected asset's path moved into a dedicated editor. It validates the path against the
same rule the server applies to a saved manifest and names why a path was rejected while it
is typed. A bound asset can be cleared. An asset can be pointed at a file another asset of
the same type already uses, chosen from a list that leads with general scenes. An asset
bound by an accepted generation run says so and stays read-only, because that path belongs
to its run. A shared asset names every scene a rebinding would reach before it is edited.

## Details

- Video and animation assets state that they have no in-app preview rather than offering a
  player that cannot resolve their file.
- The detail panel's title names the scene the asset was reached through.
- `features/activities/scene-assets.ts` holds the tree model, the reuse ranking and the
  path rule as pure functions, covered by `packages/web/test/activities-scene-assets.test.ts`.
