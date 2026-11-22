# 插件命令可要求插件已启用、可为正在进行的运行的发起者运行；插件设置需要人的登录

- **Date:** 2026-11-20
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#1665](https://github.com/Prism-Shadow/penguin-harness/pull/1665)

[English](2026-11-20-plugin-command-caller.md)

- 插件命令可以声明 `requiresProjectListing`。此后它只为 Project 在本机列出了该插件的调用方运行，其余调用方在其任何代码运行之前得到 `403 plugin_not_enabled`。
- 插件命令可以声明 `tokenCaller: "session-driver"`。此后以本机 API token（每个 Agent 的 shell 都带着它）发出的调用，以所指 Session 中正在进行的运行的发起者——一位已登录的人——的身份运行，而不是以 token 所代表的管理员的身份运行，并以此人对该 Project 的访问权为准。没有指明 Session 的 token 调用得到 `403 session_required`；没有运行在进行、运行不是已登录的人发起的、运行被他人插话过，或此人不能打开该 Project 时，得到 `403 driver_unknown`。其余命令对 token 的处理不变。
- 每次运行在进行期间记录它的发起者。排队的后续消息开始运行时，由排队的人驱动。无人署名的定时任务、Agent API、公司模式、目标模式与压缩没有驱动者；子 Agent 的 Session 算作其根 Session 的运行。重启之后没有任何运行在进行。
- 定时任务的创建者现在只能是以自己的登录保存它的人。以本机 API token 保存的定时任务，以及由 Agent 或其他人写入或改动的文件，没有创建者，其运行也没有驱动者；这类定时任务的通知发给 Project 的所有者。
- 保存插件设置与运行其中的操作（`PUT /api/admin/plugin-config`、`POST /api/admin/plugin-config/action`）需要人的登录。本机 API token 仍可读取，Agent 因此不能再自行放宽自己的沙盒。
- 在每个 Session 有自己的凭据之前的已知局限：Agent 可以指明它能触及的 Project 中的另一个 Session，以那里正在进行的运行的发起者的身份运行这类命令。
