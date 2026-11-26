# 代理、工作区与设置域的服务下沉为 library 包

- **Date:** 2026-11-20
- **Type:** refactor
- **Scope:** `server`, `library/agent`, `library/workspace`, `library/setting`, `library/benchmark`
- **PR:** [#1666](https://github.com/Prism-Shadow/penguin-harness/pull/1666)

[English](2026-11-20-library-agent-workspace-setting.md)

服务器的 agent-config、memory、export、avatar、workspace-files 与 setting 服务搬到先行的词汇包旁边。`@prismshadow/penguin-library-agent` 收入代理域的 config 服务、memory 机制（scope、transfer document、vault）、export/zip 打包与 avatar 文件处理；`@prismshadow/penguin-library-workspace` 收入 workspace files 服务、机制与文件词汇；`@prismshadow/penguin-library-setting` 收入 theme store、keybindings 边界与桌面壳中继（updater、托盘、文件夹访问与 host-command 消息）；`@prismshadow/penguin-library-benchmark` 收入 benchmark 服务、其归档代码与机制契约。归档上限与 zip 条目检查先搬进 `@prismshadow/penguin-library-http`，让 benchmark 归档与 agent export 执行同一套限制。

服务器导入这些包；library 不引用服务器。搬运的服务在绑定服务器能力（paths port）处保留服务器侧装配：Provider Module 留下，服务类搬走。API 的导出面经再导出保持完整——`@prismshadow/penguin-server/api` 与仍在用的仓内转发（`services/agent-config-service.ts`、`services/theme-store.ts` 等其余 `services/*` 装配）让旧导入路径继续解析——其余全部直接导入 library 包。

## 细节

- `library/agent`（新）：`agent-config-service`（带 paths port）、`memory-service`、`memory-archive`、`memory-transfer-document`、`agent-export`、`agent-zip`、`avatar-file`、代理词汇（`agent-vocab`、`types`、`contract`），以及 `agent-api` 伴生包的 repo 面。
- `library/workspace`（新）：`workspace-files-service`、文件机制、文件词汇（`types`、`contract`）；benchmark 域收窄的 workspace port 让位给真实服务。
- `library/setting` 增长：`theme-store`（从 UI 包的规则表读取 pack 干净基线规则）、`keybindings`、`desktop-service`、`desktop-update-port`，以及 `types` 里的桌面/设置线格式词汇。
- `library/benchmark`（新）：`benchmark-service`、`benchmark-archive`、机制契约（`contract`、`ports`、`types`）。
- `library/http` 增长：`skill-import-limits`（上限）与 `zip-entries`（条目检查），从服务器 services 搬出，让每条归档路径共享。
- 服务器的 vitest 配置内联新的 library 包——它们的包导出是 TypeScript 源码；保持 external 时运行时的 Node loader 会拒绝该扩展名。

## 兼容性

本批不改变任何行为：搬动的代码是同一份代码换了个地址。既有包子路径——`@prismshadow/penguin-server/api`、`@prismshadow/penguin-server/model-catalog`——仍导出搬动的名字（从 library 再导出）；仓内转发让旧源码路径继续解析。转发将在 penguin v0.3 与仍经过它们的仓内导入一起删除；请改为从 library 包导入搬动的模块。
