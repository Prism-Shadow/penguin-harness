# 向后兼容

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `core`
- **PR:** [#964](https://github.com/Prism-Shadow/penguin-harness/pull/964)
- **Issue:** [#963](https://github.com/Prism-Shadow/penguin-harness/issues/963)

[English](2026-10-03-backward-compatibility.md)

[SKILL.md 的 frontmatter 改为 YAML](2026-10-03-skill-frontmatter-yaml.zh.md)。磁盘上有一处是按早先的逐行写法写出的：每个已装技能的 SKILL.md。

## 旧形态：值里有未加引号「: 」的已装 SKILL.md

早先的写法不给 frontmatter 的值加引号，因此 description（或短描述）里含「: 」的已装副本——例如 `penguin-sdk` 与 `bento-slides`——不是合法 YAML。若严格按 YAML 读，这类技能会从已装技能列表与系统提示词中消失，直到用户更新或重装它。

决定：**两种格式都读。** YAML 解析器（`@prismshadow/skills` 的 `parseFrontmatter`）对 frontmatter 块抛错时，`parseSkillFrontmatter` 退回（`packages/core/src/plugins/legacy-skill-frontmatter.ts` 的 `readLegacyFrontmatter`）逐行读法——每行 `key: value` 按第一个冒号切分；对所有调用方都生效：内置库、已装技能列表、服务端的技能上传与已装版本读取。能按 YAML 解析的块只按 YAML 读。

## 用户需要做什么

不需要做任何事。旧的已装副本照常读得出，技能每次安装或更新都会把副本重写为合法 YAML。

## 何时可以移除

本次发布几个月后，由处理 [#963](https://github.com/Prism-Shadow/penguin-harness/issues/963) 的人移除。移除的内容：删除 `packages/core/src/plugins/legacy-skill-frontmatter.ts`（标有 `TODO(skill-frontmatter-fallback)`）及 `parseSkillFrontmatter` 中对它的调用，以及 `packages/core/test/plugins.test.ts` 中的用例 "still reads an older installed copy whose unquoted value is not valid YAML"；届时既有用例 "parses name/description/version and the optional short descriptions; values may contain colons" 里的 `description: a: b` 需要加引号。
