# Refresh the four development skills to the 0.2.20 tree

- **Date:** 2026-11-27
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1901](https://github.com/Prism-Shadow/penguin-harness/pull/1901)

[中文版](2026-11-27-refresh-agent-skills.zh.md)

Refreshed the four development skills under `.agents/skills/` against the 0.2.20 tree and
corrected the statements that had drifted from the code.

## Details

- `penguin-harness-dev`: corrected the package map to cover `packages/*` and `library/*`, described
  the server, CLI and desktop as the plugin hosts, moved the model-catalog reference to
  `library/model`, removed the seeded-default procedure, corrected the pricing, promotion and
  preset-sync semantics, added `pnpm lint` to the verification chain, replaced the Markdown
  `format:check` row, and updated the plugin test names, Windows job names, release version table,
  `Breaking` translation rule, MMSP package name and ai-slop layout.
- `penguin-harness-frontend`: replaced `FONT_SCALE_PX` with `TEXT_SIZE_PX` and its five tiers,
  added the `link` tone and the `window-controls` layer, updated the theme count to four packs,
  and corrected `FORM_MODULES`, the workbench load-failure rule, `VARIANT`, the site language menu,
  `toastApiError`, the Primer dark values, the icon-registry allowlist and the header wrappers.
- `penguin-harness-manual-test`: corrected the seeded admin password, the per-port session cookies
  and the Windows data root.
- `penguin-harness-writing`: scoped the docs profile to task pages, added `--version-note` to
  `translate`, removed the blog slug-list step, matched the advisory and unstrip guards to the
  script, and completed `--help`.
- Moved the screenshot capture rule, the blog-asset host and the release-polish instruction to one
  home each, with the other references pointing at it.
