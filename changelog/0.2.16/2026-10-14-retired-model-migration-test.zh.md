# 连接迁移测试保留退役模型覆盖

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[English](2026-10-14-retired-model-migration-test.md)

修正连接迁移测试，使用包含退役模型的完整目录核对已保存模型。GPT-6 Luna 替代新 Project 预置列表中的 GPT-5.6 Luna 后，旧 GPT-5.6 Luna 配置仍受测试覆盖。运行时迁移行为不变。
