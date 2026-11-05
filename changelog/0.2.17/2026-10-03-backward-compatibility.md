# Backward compatibility

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `core`
- **PR:** [#964](https://github.com/Prism-Shadow/penguin-harness/pull/964)
- **Issue:** [#963](https://github.com/Prism-Shadow/penguin-harness/issues/963)

[中文版](2026-10-03-backward-compatibility.zh.md)

[SKILL.md frontmatter became YAML](2026-10-03-skill-frontmatter-yaml.md). One thing on disk was written in the earlier, line-based form: the SKILL.md of every installed skill.

## The old shape: an installed SKILL.md with an unquoted `: `

The earlier stamper wrote each frontmatter value unquoted, so an installed copy whose description (or short description) holds `: ` — such as the `penguin-sdk` and `bento-slides` skills — is not valid YAML. Read strictly as YAML, such a skill would drop out of the installed-skill list and the system prompt until it was updated or reinstalled.

Chosen: **read both formats.** When the YAML parser (`parseFrontmatter` from `@prismshadow/skills`) throws on a frontmatter block, `parseSkillFrontmatter` falls back (`readLegacyFrontmatter` in `packages/core/src/plugins/legacy-skill-frontmatter.ts`) to the line-based reading — every `key: value` line split on its first colon — for every caller: the built-in library, the installed-skill list, the server's skill upload and its installed-version reads. A block that parses as YAML is read as YAML only.

## What users need to do

Nothing. Old installed copies keep reading as before, and each install or update of a skill rewrites its copy as valid YAML.

## When it can be removed

A few months after this release, tracked by [#963](https://github.com/Prism-Shadow/penguin-harness/issues/963), by whoever picks up that issue. The removal deletes `packages/core/src/plugins/legacy-skill-frontmatter.ts` (marked `TODO(skill-frontmatter-fallback)`) and its call in `parseSkillFrontmatter` and the test "still reads an older installed copy whose unquoted value is not valid YAML" in `packages/core/test/plugins.test.ts`; the existing test "parses name/description/version and the optional short descriptions; values may contain colons" then needs its `description: a: b` quoted.
