# Shipped skills are checked to parse

- **Date:** 2026-10-02
- **Type:** process
- **Scope:** `skills`, `tooling`, `core`
- **PR:** [#879](https://github.com/Prism-Shadow/penguin-harness/pull/879)

[中文版](2026-10-02-skills-parse-check.zh.md)

A new workspace package, `@prismshadow/skills` (`packages/skills`, publishable to npm), was added: `validateSkillDir(dir)` passes a skill directory when its `SKILL.md` is accepted by the parser vendored from [vercel-labs/skills](https://github.com/vercel-labs/skills) at `18f96ea1` (`frontmatter.ts` and `parseSkillMd`, MIT): the YAML frontmatter parses and `name` and `description` are present strings. Its only runtime dependency is `yaml`. Every plugin that ships skills was given a `test/skills.test.ts` that runs it over each of its skills, so `pnpm -r test` covers them.

## Details

- Core's built-in library test asserts that no skill name appears in two plugins: the library installs into one flat `skills/` directory.
- The descriptions of `penguin-sdk` (agent-development `2026.10.02.1`) and `bento-slides` (use-bento-slides `2026.10.02.1`) contained an unquoted `: `, which is not valid YAML; both are now double-quoted, with the text unchanged.
- `scripts/check-plugin-versions.mjs` stopped requiring a `plugin.json` bump for changes confined to a plugin's `test/` directory, which is neither installed nor packed.
