# 以插件形式提供从聊天里启动智能体的 Discord 机器人

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `plugins`, `server`
- **PR:** [#641](https://github.com/Prism-Shadow/penguin-harness/pull/641)

[English](2026-09-07-discord-bot-plugin.md)

消息绑定把一个机器人绑到某个已经在网页端打开的 Session 上。新插件 `@prismshadow/penguin-plugin-discord-bot` 把这层关系反过来：机器人只配置一次——一条 Token 加一个目标 Agent——此后每一个给它发消息的聊天（私聊、@ 它的频道、子区）都得到一个自己的 Session，在第一条消息时创建、之后复用。没有人需要先打开网页端；这些 Session 照样出现在网页端的目标 Agent 之下。

## 细节

- **服务端没有新增「聊天机器人」这个概念。** 插件把服务端已有的东西拼在一起：Discord 消息连接器（Gateway、发送、Markdown、2000 字符上限）、Session 创建、任务启动、Session 事件通道与设置存储——全部经模块的 `requires` 取得。服务端只改了两处：`Messaging.connectorFor` 公开；只含类型的插件表面导出这类插件需要的机制（`MessagingTaskRunner`、`ScheduleSessionCreator`、`SessionIndex`、`AgentIndex`、`Settings`、`Channels`、`Errors`、`Paths`、`Log`、`Clock`、连接器的类型与 `ChannelEvent`）。
- **一条 Gateway 连接，一个聊天一个 Session。** 消息按聊天 id 路由；没有 Session 的聊天经定时任务同一条路径创建一个。回复完成即送回同一个聊天：渲染 Markdown、按 Discord 上限切分、服务器频道里引用来信。图片以内联图片送达智能体，文件落进 Session scratchpad 并在消息里点名。
- **命令。** `/new` 为该聊天开新 Session；`/approve` 与 `/deny` 决定智能体正在等待的工具调用（有调用等待时机器人会说明，因为提问的人面前没有网页端）；`/status` 报出该聊天的 Session。
- **配置。** 插件自己的管理员 API `/api/discord-bot`（`GET`、`PUT {botToken?, clearBotToken?, projectId?, agentId?}`、`POST /state`、`POST /test`），经 `HttpModule.routes` 槽贡献、自带一份 Hono；或者由服务端环境变量预填（`PENGUIN_DISCORD_BOT_TOKEN`、`PENGUIN_DISCORD_PROJECT`、`PENGUIN_DISCORD_AGENT`，三者齐全即以启用状态启动）。已存的值优先于预填，关掉的机器人不会被预填重新打开。状态存在服务端设置的 `discord-bot:` 键下，重启与热更新都不丢。
- 插件随每个构建一起发布、列入内置索引、默认不安装。
