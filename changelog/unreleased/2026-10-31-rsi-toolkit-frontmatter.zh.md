# 修复 OPRO 和 APE 技能的 YAML 元数据

- **Date:** 2026-10-31
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#1411](https://github.com/Prism-Shadow/penguin-harness/pull/1411), [#1418](https://github.com/Prism-Shadow/penguin-harness/pull/1418)
- **Issue:** [#1410](https://github.com/Prism-Shadow/penguin-harness/issues/1410)

[English](2026-10-31-rsi-toolkit-frontmatter.md)

将 OPRO 和 APE 技能描述改为 YAML 块标量，保留原有文本。
两个 Skill 的版本均更新为 `2026.10.31.1`。

UI gallery 的演示库同步列出两个 Skill 的新版本；其库测试改用仓库统一的 SKILL.md 解析器按 YAML
读取每个 SKILL.md，块标量和带引号的值都按其实际描述文本比较。
