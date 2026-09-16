# 自定义分组自带 Atria Dawn Preview

- **Date:** 2026-09-15
- **Type:** feature
- **Scope:** `core`
- **PR:** [#729](https://github.com/Prism-Shadow/penguin-harness/pull/729)

[English](2026-09-15-atria-dawn-preview.md)

## 变更内容

- 内置目录的自定义分组有了第一条预置：`Atria-Dawn-Preview`——`https://api.atria-asi.ai` 的 Anthropic Messages API（客户端自行拼上 `/v1/messages`；条目未填 key 时读 `ANTHROPIC_API_KEY`），256K 上下文，只收文本，厂商公布价格前暂记 0。该端点也提供 Responses 接口，但那一侧会拒绝多轮对话里回放的 assistant 轮，所以预置走 Messages。自定义分组里的预置行自带 base URL 与钉住的通用协议，因为这个分组本身两者都不暗示；已有 Project 经模型库的「同步预置」取得它。
