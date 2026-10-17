# Shared navigation and cursors across the public sites

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `ui`, `landing`, `docs`, `ui-gallery`, `skills`
- **PR:** [#1142](https://github.com/Prism-Shadow/penguin-harness/pull/1142)

[中文版](2026-10-16-shared-site-ui.zh.md)

Landing, docs and the component gallery now use the same navigation, language menu, theme switch and GitHub link from the shared UI package. The language menu supports arrow-key navigation and returns focus to its trigger when dismissed with Esc.

Controls on these sites now share the app's arrow cursor, including buttons, tabs and disclosures. Content links retain the hand. The frontend skill covers all frontend packages and directs future changes to reuse or extend shared components and styles.
