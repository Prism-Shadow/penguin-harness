# An Asset Library for each activity

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `web`

The activity's Media library section is now an Asset Library. It used to list only the
uploaded files. It now shows two tables for the open language:

- **In the media plan**: every asset, its type, where its file came from (generated,
  uploaded, from the checkout) or that it is unbound, and the scenes that use it.
- **Uploaded files**: every upload, with an image thumbnail, its size, and the assets bound
  to it, or that nothing uses it.

Both tables can be filtered by media type, by binding (any, unbound, bound) and by a
search over keys, descriptions, file names and scenes. Choosing an asset opens it in the
asset editor.

The filter chips' look now lives in one place, shared with speech coverage.
