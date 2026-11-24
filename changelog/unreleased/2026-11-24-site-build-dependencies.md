# Build the public site from a clean checkout

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `tooling`, `landing`, `ui-gallery`

[中文版](2026-11-24-site-build-dependencies.zh.md)

The public site build now builds the server's workspace dependencies before bundling the component gallery. A fresh checkout can assemble the landing page, docs and gallery in one deployable directory.
