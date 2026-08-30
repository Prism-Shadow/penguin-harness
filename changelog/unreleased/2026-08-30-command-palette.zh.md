# Ctrl+P 打开命令面板；第一条命令是 harness 历史

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`, `server`, `core`

[English](2026-08-30-command-palette.md)

Ctrl+P（macOS 上为 ⌘P）打开一个 VS Code 风格的命令面板：一个输入框筛选命令列表，↑↓ 选择，Enter 执行，Escape 关闭。面板是机制；命令向它注册，而不是各自占用快捷键。

## Harness 历史

目前唯一的命令：一个整页（`/harness/history`），列出这台服务器的数据根通过热更新提交过的 harness 版本，最新在前——推送方记录的 checkout 修订与仓库（若有）、提交时间、标识代码本身的内容寻址 platform / cli / web bundle、当前提交的是哪个版本——以及**每次推送改了什么**：平台构建所用的接口表（`ifaces.json`）随推送一起到达，按它自己的 sha256 存储（`store/ifaces/<hash>.json`），页面把它与前一个版本比对：树的节点新增、移除或改了接线（requires、provides、contributes、children、exports），接口新增、移除或逐成员变化，以及数据类型变化的计数。`GET /api/version/history/ifaces/:hash` 返回存储的表，`GET /api/version/history/diff?from=&to=` 返回差异。

背后的记录是 `<root>/hmr/history.json`：store 每提交一个版本就追加一条（保留最新 100 条），与 bundle 本身分开——store 只为每种产物保留一份回滚副本，所以历史才是记住"推过什么"的地方。`GET /api/version/history` 连同当前提交一起返回它。
