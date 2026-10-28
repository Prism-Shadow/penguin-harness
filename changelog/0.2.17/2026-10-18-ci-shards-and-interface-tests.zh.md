# 缩短 CI 运行时间，并为终端、新对话与机器账目补上测试

- **Date:** 2026-10-18
- **Type:** process
- **Scope:** `ci`, `web`, `server`
- **PR:** [#1206](https://github.com/Prism-Shadow/penguin-harness/pull/1206)

[English](2026-10-18-ci-shards-and-interface-tests.md)

缩短了 Web 与服务器拉取请求中最长的几个 CI 任务，并用省下的一部分时间，为本轮终端、新对话与机器重连这几个缺陷背后的 Web App 模块补上测试。

## CI 布局

- Linux 上的 Web 测试拆成 `web-1` 与 `web-2` 两个任务，各跑 `web`、`ui`、`cli` 一半的测试文件（`vitest --shard`），各自上传本半的覆盖率。完整运行时 Windows 的 `sites` 分片同样一分为二；macOS 仍是一个 `sites` 任务。
- Windows 上的服务器测试仍为三个分片，测试文件改为按其在 Windows 上实测的耗时分配（`packages/server/test/shard-weights.json`，取七次运行日志的平均值，可用 `packages/server/scripts/shard-weights.mjs` 刷新），不再按路径哈希分配。
- 服务器测试在 macOS 上每个核心一个 Vitest worker，最多四个（CI 上为三个）；Linux 与 Windows 仍为两个。
- 类型检查任务只构建被检查的包所导入的内容：它们的依赖，既不构建站点产物（`web`、`ui-gallery`、`docs`、`landing`），也不构建被检查的包本身。Web 测试任务只构建 Web 的依赖，不构建其产物。
- browser-smoke 构建服务器时不生成类型声明，构建的同时安装 Chromium，并在原有冒烟用例之外运行 `dock.spec.mjs`（同时选中 `mobile-dock.spec.mjs`）与 `terminal.spec.mjs`。组件库的布局检查从 browser-smoke 移到了测试 gallery 的那个 Linux 任务中。dock 用例确认 Files 面板在屏上时，改为查找面板的刷新按钮，不再查找面板早已不显示的根目录标签。

## 新增测试

- `terminal-list.test.ts`：本服务器与各台机器上的终端列表、在持有终端的机器上关闭终端，以及只在各来源都已应答时才清理终端标签页；`test/helpers/terminal-world.ts` 是终端的假实现。
- `draft-send.test.ts`：通过草稿页发送新对话的第一条消息，覆盖机器上的 Workspace、创建或第一个 Task 被拒绝、重复点击与自愈后的新 id；`test/helpers/draft-world.ts` 提供其服务器与页面框架。
- `machines-account.test.ts`：各机器界面共同读取的机器账目（合并读取、用户已离开的 Project 迟到的应答、读取失败、普通成员、请求已带回的列表）。
- `shard-deal.test.ts`：服务器测试文件按权重分配到各分片。
