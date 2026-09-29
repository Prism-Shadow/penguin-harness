# Activities are stored in their modules

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `web`, `activities`

An activity ref's draft is now stored in its module in the WAF workspace, in Loom's layout, instead of in Penguin's data folder:

```
modules/<module>/generated/<pc>/
  spec/activity_metadata.json        the product: module, type, reading mode, canonical ref, tags
  spec/penguin.json                  which Penguin project owns the product
  refs/<pc>-<ref>/spec/
    activity_metadata.json           the ref: number, title, display name, stable
    activity_spec.json               the specification
    activity_description.txt         the author's description
    asset_manifest.json              the media plan's manifest
    implementation_features.json     the selected implementation features
    penguin.json                     the draft's status, revision, media-plan provenance, module-document edits, pinned build
```

Penguin is the only writer of these files, so its own fields may sit inside Loom's. What Loom's files have no place for is in `penguin.json`, committed with the module. The database remains an index over the files, and `penguin.json` is written last. As before, a draft whose files changed after it was saved reads as "draft" until it is saved again.

- **One project owns a product.** The module is shared across the server, so creating a ref of a product that another project owns is refused with 409 `product_taken`.
- **A new ref must not collide.** Creating a ref whose folder already exists in the module is refused with 409 `activity_exists`.
- **New modules are repositories.** In the managed workspace a new product's module is cloned, or started empty with origin set. In an existing checkout it is started the same way, locally, with nothing fetched.
- **Renumbering moves files.** A ref's folder moves with its number, and so do the module's `configurations/<pc>-<ref>.json` and `assessments/<pc>-<ref>.json`, as Loom's renamer moved them. The old refusal to renumber a ref whose module is in the checkout is gone.
- **`WAF_ROOT_DIR` now takes precedence** over the workspace's "Checkout folder" setting.
- **Not moved yet:** uploads, generated media and saved versions are still under Penguin's data folder; media moves to the media repository next. Existing drafts under `~/.penguin` are not moved yet either: a one-time migration follows.
