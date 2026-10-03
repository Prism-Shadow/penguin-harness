# SKILL.md 的 frontmatter 按 YAML 读写

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `core`, `skills`
- **PR:** [#964](https://github.com/Prism-Shadow/penguin-harness/pull/964)
- **Issue:** [#963](https://github.com/Prism-Shadow/penguin-harness/issues/963)

[English](2026-10-03-skill-frontmatter-yaml.md)

技能加载器原先逐行读 SKILL.md 的 frontmatter，每行按第一个冒号切 `key: value`、值原样保留，写安装副本的 frontmatter 则用字符串拼接。于是加引号的值连引号一起读进来（并进入系统提示词），多行的值只读到第一行，写出的安装副本也未必是合法 YAML——而 [Agent Skills 规范](https://agentskills.io/specification)与其他读技能的工具都按 YAML 读。

## 细节

- 仓库内只有一个 SKILL.md 解析器：从 vercel-labs/skills vendor 进 `@prismshadow/skills`（[#879](https://github.com/Prism-Shadow/penguin-harness/pull/879)）的 `parseFrontmatter`。该包现在导出它，并新增非 vendor 的 `formatFrontmatter`：按给定字段顺序用 `yaml` 写出 frontmatter 块，只在 YAML 需要时加引号，每个值保持一行。
- `parseSkillFrontmatter` 用该解析器读块，core 只负责把解析结果映射为技能元数据：裸数字或布尔值按其字符串读，`2026.08.29.3` 这类版本号保持原样；结果不是映射时按无 frontmatter 处理。字段、默认值与返回形状不变，内置库读取、注入系统提示词的已装技能列表、服务端的技能上传与已装版本读取都无需改动。
- `stampSkill` 用 `formatFrontmatter` 写安装副本的 frontmatter，字段顺序不变（`name`、`description`、`short_description`、`short_description_zh`、`version`）。写出的结果按 YAML 与按加载器读回都与原值相同。
- core 把 `@prismshadow/skills` 列为 devDependency 并打包进自己的构建产物（tsup `noExternal`），发布的 core 自带该解析器，不依赖这个包；`yaml` 仍是 core 的依赖。
- 按 YAML 不合法的块退回逐行读法，本改动之前写出的安装副本照常读得出；见[向后兼容](2026-10-03-backward-compatibility.zh.md)。
