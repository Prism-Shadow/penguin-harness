# SVG preview sizing and concise file replies

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `ui`, `core`
- **PR:** [#1130](https://github.com/Prism-Shadow/penguin-harness/pull/1130)

[中文版](2026-10-14-svg-preview-prompt.zh.md)

Fixed image previews collapsing to a dot for SVGs with a `viewBox` and no fixed dimensions. Enlarged images now fit the viewport while keeping their aspect ratio.

The default prompt now asks for file paths without repeating their code unless requested. Framework reuse and CLI scaffolding were separated from the React preference, and the redundant library-availability clause was removed.
