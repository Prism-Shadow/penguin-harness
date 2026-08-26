# The skills package README lists the whole library again

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`
- **PR:** [#416](https://github.com/Prism-Shadow/penguin-harness/pull/416)

[中文版](2026-08-23-skills-readme-group-table.zh.md)

The group table in `packages/skills/README.md` named 14 of the 18 shipped Skills: `bento-slides`,
`humanizer`, `remote-claude-code` and `skill-porting` were added to `SKILL_GROUPS` and to the
docs pages, but not to the README. The four were added, and a test now derives the check from
the library so the table cannot fall behind again.

## Details

- The table follows `SKILL_GROUPS` order, and a line below it names the two `preinstall: false`
  Skills — `humanizer` and `remote-claude-code` — as install-on-demand.
- The new test reads `README.md` and asserts every name from `loadLibrarySkills()` appears in it,
  mirroring the docs package's `skills-sync.test.ts`. The existing group assertions catch a Skill
  missing from the manifest; nothing had covered the README.
