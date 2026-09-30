# deploy.mjs skips a push of the build the target already has

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `tooling`, `server`, `core`
- **PR:** [Myriad-Dreamin/penguin-harness#113](https://github.com/Myriad-Dreamin/penguin-harness/pull/113)

[中文版](2026-09-30-deploy-skips-the-same-build.zh.md)

`scripts/deploy.mjs` reads the target's `GET /api/version` before pushing and stops when the target has already committed exactly this build, instead of making it import the same platform again as another generation.

## Details

- The platform, cli, web and assets pointers are recomputed from the bytes about to be sent, by the rules the runtime names its store files with, and all four must equal the committed ones. The script then prints `the target already has this build … nothing pushed` and exits 0.
- Any other answer pushes as before: no report, nothing pushed yet, a pointer that differs, or a platform whose report does not name its assets yet.
- `--force` pushes without the check.
- The version report (`GET /api/version`, `penguin version --json`) gained `harness.assets`: the committed native-assets directory, relative to `<root>/hmr`, or null when the version carries none.
