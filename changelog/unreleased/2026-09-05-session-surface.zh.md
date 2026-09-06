# 一个 Session 有一个表面，Claude Code 是第一个

- **Date:** 2026-09-05
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `tooling`
- **PR:** [#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

[English](2026-09-05-session-surface.md)

会话页不再默认每个 Session 都是对话。一个 Session 可以带一个**表面**——插件贡献的一种，决定会话页为它渲染什么、它的空闲 / 运行状态从哪里来。内建对话是「没有表面」；第一个贡献的表面是 `claude-code`，在 Session 的 Workspace 里打开 Claude Code 的 TUI。见 PRFC-0009。

## 表面这一层

插件经新增的 `SessionSurfacesModule.surfaces` 槽贡献一种表面：清单半（`kind`、标签、渲染器）就是 `GET /api/contributions` 现在以 `sessionSurfaces` 交给前端的东西，代码半是服务端打开、查询、关闭的 `SessionSurface`。同一 `kind` 出现两次是启动错误——`kind` 写在该种每个 Session 上。词汇是 `@prismshadow/penguin-core/plugin` 的纯类型；表面插件可以 require 的接口（`Terminals`）在 `@prismshadow/penguin-server/plugin` 面上。

表面 Session 不带模型引用（`sessions.surface` 是新增列，对话为 `NULL`）（它如何抵达存量数据库，见[兼容性条目](2026-09-05-backward-compatibility.zh.md)），也不建 core Session：SessionManager 从不驱动它，一切运行形态的调用（Task、压缩、steer、审批）一律 409 `surface_session`。它的状态是表面自己的，推入 SessionManager，`statusOf`——以及每个列表行——因此为它作答，并以运行翻转同样的 `session_state` 事件推送，侧栏的运行与未读圆点不变。`POST /api/sessions/:id/surface` 打开它（幂等，可带一句首提示），`GET` 查询，`DELETE` 关闭；删除 Session 也一并关闭。

## 会话页开始消费贡献

Web App 现在每个登录用户取一次 `GET /api/contributions`。其 `pages` 并入路由——推送上来的平台或插件贡献的页面，只要本构建有它的渲染器就能挂载——其 `sessionSurfaces` 成为「新建对话」页上一个选择器的选项，与 Agent、Workspace 并列的第三颗药丸，因此表面总是在用户选定的 Workspace 里打开。只有当插件确实贡献了表面时，这颗药丸才出现。表面 Session 的会话路由渲染该表面的渲染器（`TerminalSurface` 挂上停靠栏同款终端视图；`iframe` 渲染器加载插件自己的页面），而不是消息流与输入框。

终端现在能跑一个程序而不是一个 shell：`Terminals.create` 接受 `command`（argv，不加登录 shell）、`env` 与 `unsetEnv`，供表面使用，不经 HTTP 暴露。pty 也不再继承服务端的 `TMUX` / `TMUX_PANE`——它并不是启动服务端的那个复用器的一个 pane，而误以为自己在 tmux 里的程序会朝着并不存在的东西发送穿透序列。

## claude-code 插件

`@prismshadow/penguin-plugin-claude-code`（`plugins/claude-code`）贡献 `claude-code` 表面：一个「新建对话」入口，在 Session 的 Workspace 里运行 `claude`（或 `PENGUIN_CLAUDE_BIN`），首提示作为它的首个参数与 Session 标题。状态是启发式——窗口内有输出即运行、静默即空闲、退出即空闲——因为 pty 报告不了「在思考」。它会把上级的 Claude Code 会话标记（`CLAUDECODE`、`CLAUDE_CODE_SESSION_ID`、消息 socket 与 token 等）从 pty 环境里剔除：否则一个从 Claude Code 会话里启动的 harness 会把它们交给子进程，子进程据此认为自己是嵌套的，于是关掉 transcript 保存。部署有意设置的配置（如 `CLAUDE_CODE_USE_BEDROCK`）原样继承。它随每个构建分发、列入内置插件索引，但**默认不安装**：运营者像装任何插件一样装它。

## 插件集成测试框架

`@prismshadow/penguin-plugin-test`（`packages/plugin-test`）以插件已安装的方式启动真实服务端，一如 `@vscode/test-electron` 启动真实的 VS Code：`startHarness({ plugins })` 写好临时数据根的 `plugins.json`、以子进程运行服务端、返回一个已登录的客户端（`get` / `post` / …、一个终端助手）与 `stop()`。插件由真实 loader 加载，因此测试证明的是「这个包能被解析、装载、进树」，而不是它的替身。`claude-code` 的集成测试用它、配一个假 `claude` 跑完整条表面生命周期。
