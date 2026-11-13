# PRFC-0012 从聊天里启动智能体的机器人是插件的事

[English](PRFC-0012-chat-bots.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0012-chat-bots.md`——草案，见设计 PR [#127](https://github.com/Prism-Shadow/penguin-harness-design/pull/127)（draft）。
> **修订**：v1.0.0（迁入主仓，取草案当前版本）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `discord_bot_plugin`
- Start Date: 2026-09-07
- PRFC PR: [Prism-Shadow/penguin-harness-design#127](https://github.com/Prism-Shadow/penguin-harness-design/pull/127)
- Implementation PR: [Prism-Shadow/penguin-harness#641](https://github.com/Prism-Shadow/penguin-harness/pull/641)

## Summary
[summary]: #summary

「在 Discord 上发消息就有一个智能体来回答」这件事，由插件 `@prismshadow/penguin-plugin-discord-bot` 独自完成，平台**不新增**任何「聊天机器人」概念。插件按清单 `requires` 取得平台已有的机制——消息桥的连接器、Session 创建、任务启动、Session 事件通道、设置存储、插件配置——自己拼成一个机器人：一条 Gateway 连接，每个聊天一个 Session，回复送回原处，几条命令，一条只读的状态路由；配置在系统设置的「插件」页里填写。平台为此做三件小事：把桥的 `connectorFor` 公开，在只含类型的插件表面导出这些既有机制，并给所有插件一个通用的**插件配置**机制——包在清单里声明选项、管理员在「插件」页填写、模块经 `PluginConfig` 读取并 watch。

## Motivation
[motivation]: #motivation

需求是「我能在 Discord 上启动 agent 并交互」。按 Session 绑定（05「消息接入」）做不到：它要求先在网页端开一个对话、把机器人绑上去，且一个机器人账号同一时刻只服务一个对话。在聊天软件里提问的人面前没有网页端，他要的是发消息就有智能体回答，换一个频道就是另一段对话。

第一版把这套逻辑做成了平台里的 `ChatBotsModule`（一个与渠道无关的宿主 + 一个给插件的槽），插件只剩一条清单项。这被否决了：**不要为一个插件的需求给核心加抽象**。平台该提供的是机制，不是「机器人」这种产品形态；Telegram 或飞书的机器人插件真出现时，再看有没有值得抽出来的公共部分——那时抽出来的才是真的公共部分。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**给运营者。** 在 Project 的插件页装上 `discord-bot`（构建自带，默认不装，不用重启）。在 Discord 开发者后台建应用、加机器人、复制 Token，用 OAuth2 链接把它请进服务器。然后打开系统设置（用户菜单，仅管理员）的「插件」页，机器人列在那里，填四项：Bot Token、Project、Agent（缺省 `default_agent`）、启用。保存即生效，不用重启；读 `GET /api/discord-bot`（仅管理员）能看到状态。配置只在这一页——没有环境变量，也没有要手改的文件。

**给使用者。** 私聊机器人，或在频道里 @ 它，就是在和一个智能体对话。回复回到同一个频道（频道里引用你的那条消息）；图片与文件附上就到。`/new` 从头开始；智能体要执行需要审批的工具调用时，机器人会说一声，回 `/approve` 允许、`/deny` 拒绝；`/status` 报出这段对话对应的 Session。这些 Session 也出现在网页端的目标 Agent 之下。

**给插件作者。** 这个包就是「代码插件能做到什么」的样本：清单里 `requires` 平台的机制、`contributes` 一条路由，代码里把它们拼起来；配置在清单里声明、由平台存储与展示，而不是自设一套存储或一个设置页。换一个平台有连接器的渠道，同样的包形状就是那个渠道的机器人。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 平台侧的改动（仅此三处）

- `Messaging` 机制多一个公开方法 `connectorFor(channel)`：桥里本来就有，只是私有。
- `@prismshadow/penguin-server/plugin`（只含类型）新增导出：连接器接缝的类型（`MessagingChannelConnector` / `MessagingClient` / `MessagingConnection` / `MessagingConnectorHandlers` / `MessagingInboundMessage` / `MessagingInboundImage` / `MessagingInboundFile` / `MessagingSendOptions` / `MessagingChannel`）、`MessagingTaskRunner`、`ScheduleSessionCreator`、`SessionIndex`、`AgentIndex`、`Projects`、`ProjectConfigStore`、`Settings`、`Channels`、`ChannelEvent`、`Errors`、`Paths`、`Log`、`Clock`。全是既有机制，导出只是让插件能在清单里 `requires` 它们。
- **插件配置**（通用，不只为这个插件）：`package.json#penguin.configuration` 声明选项——标题与说明（带 `…Zh` 中文半边）加 `properties`，每个字段 `string` / `secret` / `boolean` / `number` / `project` 之一，各带标题、说明、缺省值、占位文字与 `required`；loader 不运行包就读出它，画不出来的 schema 使该插件加载失败并点名文件。值服务端全局存在 `server_settings` 的 `plugin-config:<包名>` 下、每包一份 JSON 文档；密钥明文落库、一切 API 表面掩码，掩码原样送回即保持、送空即清除，`required` 不得落空。平台根下新增 `PluginConfigModule`（与设置组分开，替换设置组的插件换掉的是存储而不是这一层），导出机制 `PluginConfig`——`get(name)` 答出合并到缺省值上的存储值，`watch(name, cb)` 在每次保存后触发——与 `PluginConfigAdmin`（`describe` / `set`，给路由用）。管理员路由 `GET/PUT /api/admin/plugin-config`；系统设置弹窗新增「插件」子页（服务器分组、仅管理员、排在「沙箱」之后），按 schema 画表单、每个插件各自保存。

### 插件

- 包 `plugins/discord-bot`，一个模块 `DiscordBot`。清单 `requires`：`Messaging`（from `MessagingHubModule`——`from` 须是平台根下可见的模块）、`MessagingTaskRunner` / `Sessions` / `ScheduleSessionCreator` / `SessionIndex`（`SessionRuntimeModule`）、`AgentIndex`（`ProjectsModule`）、`Settings`（`SettingsModule`）、`PluginConfig`（`PluginConfigModule`）、`Channels` / `Paths` / `Log`（`RuntimeModule`）、`Errors`（`ObservabilityModule`）；`contributes` `HttpModule.routes`：`{ id: "discord-bot.routes", prefix: "/api/discord-bot", auth: "user" }`。运行时 `import` 平台的 SDK（`@prismshadow/penguin-core`，打包时标为 external，用宿主那一份）取 `userText` / `imageUrlMessage` / `attachedFileLine` / `scratchpadDir` / `modelVisiblePath`；自带一份 Hono 出路由（宿主的 `route()` 按子应用的 `routes` 逐条挂载，跨副本可用，错误由子应用自己的 `onError` 渲染为 JSON）。
- 配置：清单声明 `bot_token`（secret，必填，须解得出机器人 id）、`project`（project，必填）、`agent`（string，缺省 `default_agent`，须存在于该 Project）、`enabled`（boolean，缺省 true）。管理器（manager.ts）经 `PluginConfig.get` 读本包的值、`watch` 每次保存：值凑得成机器人就建一个（同样的值不重启，变了就按新值重启），凑不成的以原因记在 `error` 里而不建，值清空就停掉；一个部署一个机器人。Token 明文在服务端设置里，与代理地址、消息绑定凭据同一权衡；状态路由只返回掩码。
- 聊天表：`server_settings` 一把键 `discord-bot:chats:<projectId>` → `{ [chatId]: { sessionId, isDirect, lastMessageId } }`；读取时丢弃 Session 已被删除的条目。
- 运行时（这一个机器人）：一条入站连接（`connector.connect`）与一个出站客户端（`connector.createClient`），以代际编号使被替换的连接回调失效。入站按 `chatId` 路由：没有 Session 的聊天经 `ScheduleSessionCreator.createSession({ projectId, agentId })` 开一个、存表、订阅其通道；输入合成——文本原样、图片按 20MB 上限取回成 `image_url` 部分、文件写进 `scratchpadDir(root, projectId, agentId)/<sessionId>/`（名字消毒、独占创建、按管理员设定的单文件与总量上限）并以 `attachedFileLine` 追加在文本之后——以 `queueIfBusy` 发起 Task；任何一项取不回来即整条消息停下并回以双语提示。命令在文本开头识别（`/` 或 `!`）：`new`、`approve` / `deny`（取该聊天最早一条待审批的 `toolCallId` 交给 `Sessions.decideApproval`）、`status`。去重：内存记最近 64 条消息 id，聊天表记每个聊天最后处理完的消息 id，连接建立时折回内存。出站：只转发主会话已完成的 assistant 文本、跳过压缩窗口；按段落、行、硬切三级在 1900 字符处切分后交给连接器渲染 Markdown 发送（渲染后仍超限的由连接器退回纯文本）；群聊里一次运行的第一条引用来信；同一聊天的发送串行；`approval_request` 另发一条点名 `/approve` / `/deny` 的提示并记下 `toolCallId`。异常记 error_records（来源 `messaging`；连接器自报可恢复的关闭记为 expected）。
- 连接状态 `{ state, lastError?, changedAt?, lastInboundAt?, lastDeliveryError? }` 只存内存，经 `GET /api/discord-bot` 以 `{ bot: { projectId, agentId, botTokenMasked, enabled, status, chats } | null, error, configured }` 返回。

### 兼容性

只增不改；没有存量数据受影响。

## Drawbacks
[drawbacks]: #drawbacks

- 入站合成与出站转发和消息桥有一段平行的逻辑（桥的那份还多投递偏好、回复文件跟发、滚动图片预算、按构件边界的分段）。这是有意的：第二个渠道的机器人插件出现之前，不猜哪部分值得抽成公共的。
- 插件自带一份 Hono；宿主与插件的 Hono 版本各自演进，跨副本挂载依赖 `route()` 的实现细节保持稳定。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **平台里的 `ChatBotsModule` + 槽**（第一版）：插件最薄，但把一种产品形态写进了核心。被否决。
- **改消息桥、让绑定按聊天路由**：复用最多，但要改桥的连接模型与整套「启用即绑定」的规则与 UI。
- **会话表面（PRFC-0009）**：那是「Session 渲染什么」；这里 Session 是普通对话，只是入口在聊天里。

## Prior art
[prior-art]: #prior-art

- 本仓库的会话表面插件 `claude-code`：同样是清单 `requires` 一个平台机制（`Terminals`）、代码里拼起来。
- 本仓库的消息绑定与定时任务：连接器接缝、双语提示、附件路径、按需建 Session 的路径。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 是否要网页端的设置页（把 `[discord_bot]` 表暴露成表单），以及它依赖的「贡献页面进导航」。
- 按 Discord 用户还是按频道开 Session（同一频道多人对话时）。
- 第二个渠道的机器人插件出现时，桥与插件之间哪些逻辑值得抽成共享助手。

## Future possibilities
[future-possibilities]: #future-possibilities

- Telegram / 飞书 / QQ / 微信的机器人插件：同一个包形状。
- 把入站合成（图片预算、文件落盘）与出站分段抽成平台导出的助手，让插件与桥共用。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
