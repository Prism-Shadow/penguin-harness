# SKILL.md frontmatter is read and written as YAML

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `core`, `skills`
- **PR:** [#964](https://github.com/Prism-Shadow/penguin-harness/pull/964)
- **Issue:** [#963](https://github.com/Prism-Shadow/penguin-harness/issues/963)

[中文版](2026-10-03-skill-frontmatter-yaml.zh.md)

The skill loader read a SKILL.md's frontmatter line by line, splitting each `key: value` on its first colon and keeping the value verbatim, and wrote an installed copy's frontmatter by string concatenation. A quoted value was read with its quotes (and they reached the system prompt), a multi-line value was cut at its first line, and an installed copy was not always valid YAML — the format the [Agent Skills specification](https://agentskills.io/specification) and other skill readers use.

## Details

- The repository has one SKILL.md parser: `parseFrontmatter`, vendored from vercel-labs/skills into `@prismshadow/skills` ([#879](https://github.com/Prism-Shadow/penguin-harness/pull/879)), which now exports it together with a new, non-vendored `formatFrontmatter` that writes a block from ordered fields with `yaml` (quoting a value only where YAML needs it, each value on one line).
- `parseSkillFrontmatter` reads the block with that parser and only maps its data to the skill metadata: a bare number or boolean is read as its string, so a version such as `2026.08.29.3` stays as written, and a block that is not a mapping reads as no frontmatter. The fields, their defaults and the returned shape did not change, so the library reader, the installed-skill list injected into the system prompt, and the server's skill upload and installed-version reads needed no change.
- `stampSkill` writes the installed copy's frontmatter with `formatFrontmatter`, in the same field order (`name`, `description`, `short_description`, `short_description_zh`, `version`). The result reads back to the same metadata through YAML and through the loader.
- Core lists `@prismshadow/skills` as a devDependency and bundles it into its build (tsup `noExternal`), so the published core carries the parser and does not depend on that package; `yaml` stays a core dependency.
- A block that is not valid YAML falls back to the line-based reading, so an installed copy written before this change still reads; see [backward compatibility](2026-10-03-backward-compatibility.md).
