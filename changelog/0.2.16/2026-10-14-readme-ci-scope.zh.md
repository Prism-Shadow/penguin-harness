# 将 README 改动的 CI 范围缩小到目录校验

- **Date:** 2026-10-14
- **Type:** process
- **Scope:** `ci`
- **PR:** [#1136](https://github.com/Prism-Shadow/penguin-harness/pull/1136)

[English](2026-10-14-readme-ci-scope.md)

根目录 README 和插件目录 README 的改动改为选择独立的 Linux 目录校验，不再选中 core 及其下游包。该校验检查 README 表格是否与随包发布的插件库一致。

其他文件的改动仍按受影响的包选择检查。已选中 core 测试时，目录校验随 core 测试执行，独立的 README 任务跳过。
