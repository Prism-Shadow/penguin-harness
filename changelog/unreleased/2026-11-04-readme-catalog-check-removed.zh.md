# 移除 README 目录校验

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `ci`, `server`
- **PR:** [#1465](https://github.com/Prism-Shadow/penguin-harness/pull/1465)

[English](2026-11-04-readme-catalog-check-removed.md)

README 中的插件表格不再与随包发布的插件库比对：`README catalog` CI 任务、CI 规划中的 `readme` 选项以及 `packages/server/test/plugin-library.test.ts` 中针对 README 表格的用例均已移除。与其他文档一样，目录 README 的改动不再选择任何 CI 任务。表格由人工维护，在评审时检查。
