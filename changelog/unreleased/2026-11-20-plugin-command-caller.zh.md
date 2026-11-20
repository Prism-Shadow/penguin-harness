# 插件命令可要求插件已启用、可为 Session 的驱动者运行；插件设置需要人的登录

- **Date:** 2026-11-20
- **Type:** feat
- **Scope:** `core`, `server`, `cli`

[English](2026-11-20-plugin-command-caller.md)

- 插件命令可以声明 `requiresProjectListing`。此后它只为 Project 在本机列出了该插件的调用方运行，其余调用方在其任何代码运行之前得到 `403 plugin_not_enabled`。
- 插件命令可以声明 `tokenCaller: "session-driver"`。此后以本机 API token（每个 Agent 的 shell 都带着它）发出的调用，以最近在所指 Session 中发起运行的人的身份运行，而不是以 token 所代表的管理员的身份运行。没有指明 Session 的 token 调用得到 `403 session_required`；Session 没有记录任何人、或其驱动者已不能打开该 Project 时得到 `403 driver_unknown`。其余命令对 token 的处理不变。
- 每当已登录的人发起或插话一次运行、或定时任务为其创建者发起运行时，Session 索引都会记录这个人（`driven_by`），因此重启前后答案相同。子 Agent 的 Session 沿用其根 Session 的记录。本次改动之前的 Session 不记录任何人，直到有人在其中发起运行。
- 保存插件设置与运行其中的操作（`PUT /api/admin/plugin-config`、`POST /api/admin/plugin-config/action`）需要人的登录。本机 API token 仍可读取，Agent 因此不能再自行放宽自己的沙盒。
- 在 Session 之外，CLI 遇到 `session_required` 拒绝时会用保存的登录重试一次，与它对 `human_required` 的处理相同。
