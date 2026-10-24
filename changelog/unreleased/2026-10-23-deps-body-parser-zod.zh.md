# 依赖：body-parser 1.20.9 与 zod 4.6.7

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1306](https://github.com/Prism-Shadow/penguin-harness/pull/1306)

[English](2026-10-23-deps-body-parser-zod.md)

刷新了 lockfile 中的两个传递依赖副本，关闭两条高危 Dependabot 告警。各父包现有的版本范围都已包含修复版本，因此没有改动任何 manifest 中的范围，也没有新增工作区 override。

- **body-parser 1.20.6 → 1.20.9**——GHSA-27r3-jxmh-p828（压缩请求体之后附带的多余字节可导致拒绝服务；1.20.9 修复）。它经由 `@prismshadow/mmsp` → `express` 4.22.2（`~1.20.5`）引入；mmsp 只有 `integration/*` 入口会加载 express，而 harness 一个都没有导入。
- **zod 4.4.3 → 4.6.7**——GHSA-mrhx-c7xc-m3w5（校验超大的带约束集合时可能耗尽内存；4.6.6 修复）。zod 是 MCP SDK（`core` 与 `cli` 中的 `@modelcontextprotocol/client`，范围 `^4.2.0`）的运行时依赖、mmsp 之下 Anthropic 与 OpenAI SDK 的可选 peer，也是 core 为 MCP 测试 fixture 声明的 devDependency。4.6.7 是 `^4.2.0` 范围内的最新版本。
