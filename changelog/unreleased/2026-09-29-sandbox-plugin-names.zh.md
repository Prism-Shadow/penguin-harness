# 沙盒后端与其他插件同一命名

- **Date:** 2026-09-29
- **Type:** refactor
- **Scope:** `plugins`, `server`, `docs`, `release`, `ci`
- **PR:** [Myriad-Dreamin/penguin-harness#68](https://github.com/Myriad-Dreamin/penguin-harness/pull/68)

[English](2026-09-29-sandbox-plugin-names.md)

四个沙盒后端改为遵循 Agent 插件已经遵循的规则：`plugins/<目录>` 即 npm 包 `@penguinharness/<目录>`。

| 旧名 | 新名 |
| --- | --- |
| `@prismshadow/penguin-plugin-sandbox-bwrap` | `@penguinharness/sandbox-bwrap` |
| `@prismshadow/penguin-plugin-sandbox-seatbelt` | `@penguinharness/sandbox-seatbelt` |
| `@prismshadow/penguin-plugin-sandbox-wsl` | `@penguinharness/sandbox-wsl` |
| `@prismshadow/penguin-plugin-sandbox-dsh` | `@penguinharness/sandbox-dsh` |

- 原先出现旧名的地方都改用了新名：
  - 内置插件索引，以及各后端的 README 与入口模块；
  - 服务端沙盒模块里的后端表；
  - 配置与插件两页文档，以及贡献指南；
  - 发布工作流里检查 CLI 安装包带上 bwrap 后端的那一步；
  - 构建它的 CI 分片。
- 新增一条测试，对四个后端钉住这条规则。
- 后端在 Harness 内部的身份没有变：设置组（`sandbox-<x>`）、后端名（`penguin-<x>`）与贡献 id 都不含包名，已保存的沙盒设置不受影响。
- 后端仍是 private、不发布；本次只改了名。
