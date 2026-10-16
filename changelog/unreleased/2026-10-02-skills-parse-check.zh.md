# 随插件发出的技能检查能否解析

- **Date:** 2026-10-02
- **Type:** process
- **Scope:** `skills`, `tooling`, `core`
- **PR:** [#879](https://github.com/Prism-Shadow/penguin-harness/pull/879)

[English](2026-10-02-skills-parse-check.md)

新增 workspace 包 `@prismshadow/skills`（`packages/skills`，可发布到 npm）：`validateSkillDir(dir)` 在技能目录的 `SKILL.md` 能被 vendor 自 [vercel-labs/skills](https://github.com/vercel-labs/skills)（`18f96ea1`，`frontmatter.ts` 与 `parseSkillMd`，MIT）的解析器接受时判为通过：YAML frontmatter 能解析，且 `name`、`description` 存在并为字符串。它唯一的运行时依赖是 `yaml`。每个带技能的插件都新增了 `test/skills.test.ts`，对自己的每个技能跑这道检查，`pnpm -r test` 因而覆盖到它们。

## 细节

- core 的内置技能库用例断言同一个技能名不会出现在两个插件里：整个库装进同一个扁平的 `skills/` 目录。
- `penguin-sdk`（agent-development `2026.10.02.1`）与 `bento-slides`（use-bento-slides `2026.10.02.1`）的 description 含未加引号的 `: `，不是合法 YAML；现在都加上了双引号，文字不变。
- `scripts/check-plugin-versions.mjs` 不再因只改动插件 `test/` 目录而要求 bump `plugin.json`——该目录既不安装也不打包。
