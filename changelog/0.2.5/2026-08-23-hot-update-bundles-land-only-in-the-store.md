# A pushed platform bundle lands in the store, and nowhere else

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#422](https://github.com/Prism-Shadow/penguin-harness/pull/422)

[中文版](2026-08-23-hot-update-bundles-land-only-in-the-store.zh.md)

Every push wrote its platform bundle to disk twice: once into `<data root>/hmr/uploads/`, so
the boot had a file to import, and once more into the content-addressed store when the
version was committed. Only the store copy was ever read again, and only the store was swept
— `hmr/uploads/` grew by one multi-megabyte file per distinct bundle pushed, for the life of
the installation. A watch-and-push development loop filled it fastest, but nothing ever
emptied it.

The bundle now goes straight to its content-addressed path in the store and is imported from
there, so the bytes exist once and the sweep that already bounds the store bounds them.
`hmr/uploads/` is removed by that same sweep on the next successful push.

## Details

- A push that fails to boot leaves its bundle unreferenced in the store rather than
  committed; the next successful push's sweep collects it, and the committed version is kept
  regardless of how many failed pushes sit between them.
- The live swap and the disk commit share one more write than before: a data root whose
  `hmr/store/` cannot be written at all now fails the push instead of applying it live and
  reporting `persisted: false`. The running version is untouched either way.
