# Fix OPRO and APE skill frontmatter

- **Date:** 2026-10-31
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#1411](https://github.com/Prism-Shadow/penguin-harness/pull/1411), [#1418](https://github.com/Prism-Shadow/penguin-harness/pull/1418)
- **Issue:** [#1410](https://github.com/Prism-Shadow/penguin-harness/issues/1410)

[中文版](2026-10-31-rsi-toolkit-frontmatter.zh.md)

Converted the OPRO and APE skill descriptions to YAML block scalars, preserving their text.
Advanced both Skill versions to `2026.10.31.1`.

The UI gallery's demo library lists both Skills at the new version, and its library test reads
each SKILL.md as YAML with the repository's SKILL.md parser, so block scalars and quoted values
compare as the descriptions they hold.
