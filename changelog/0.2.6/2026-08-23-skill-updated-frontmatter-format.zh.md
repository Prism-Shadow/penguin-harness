# Skill 的 `updated` frontmatter 只留一种成文格式

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `docs`, `skills`, `server`
- **PR:** [#418](https://github.com/Prism-Shadow/penguin-harness/pull/418)

[English](2026-08-23-skill-updated-frontmatter-format.md)

Skills 文档页把 `updated` 说成"更新日期"并给出 `updated: 2026-07-17`，而内置技能库里的每个 Skill、
`skill-porting` 与 `agent-initialization` 中"如何写一个 Skill"的规范、以及库测试里的断言，用的都是
ISO 8601 UTC 时间戳。这次把文档和两处 DTO 注释统一到技能库实际采用的格式上。

## 细节

- `skills.en.md` / `skills.zh.md`：frontmatter 表格条目与示例都改为 ISO 8601 UTC 时间戳，容错解析那段
  补上"该值按原样存储、从不解析"，并在旁边说明技能库的约定。
- `packages/skills/src/index.ts` 的字段注释与 `packages/server/src/api/types.ts` 中的
  `SkillMetadataItem` DTO 同步改写。
- 解析行为未变：`updated` 仍是不透明字符串、缺省为空串，Web App 仍将其渲染为相对日期。
