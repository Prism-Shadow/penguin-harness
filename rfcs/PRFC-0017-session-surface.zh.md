# PRFC-0017 会话表面

[English](PRFC-0017-session-surface.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0017-session-surface.md`——草案，见设计 PR [#123](https://github.com/Prism-Shadow/penguin-harness-design/pull/123)（draft）。
> **修订**：v1.0.0（迁入主仓，取草案当前版本）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `session_surface`
- Start Date: 2026-09-05
- PRFC PR: [Prism-Shadow/penguin-harness-design#123](https://github.com/Prism-Shadow/penguin-harness-design/pull/123)
- Implementation PR: [Prism-Shadow/penguin-harness#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

## Summary
[summary]: #summary

一个 Session 有一个**表面**（surface）：会话页为它渲染什么、它的「空闲 / 运行」状态从哪里来。内建表面是 OmniMessage 对话。插件以**一条贡献**加入另一种表面——清单里是种类、标签与渲染器名字，代码里是打开、查询与关闭——前端经 `GET /api/contributions` 读到表面清单，用自己认得的渲染器画它，「新建对话」为每种表面多出一个入口。第一个表面插件是 `claude-code`：在 Session 的 Workspace 里打开 Claude Code 的 TUI。随之而来的是插件集成测试框架 `@prismshadow/penguin-plugin-test`：像 VS Code 的 `@vscode/test-electron` 一样，把真实的服务端连同待测插件拉起来，测试对着它跑。

## Motivation
[motivation]: #motivation

需求本身很具体：把会话页定制成打开 Claude Code 的 TUI。它不该是内核的功能——Claude Code 是别人的产品，装没装、想不想用都因部署而异——所以要做成插件。这就迫使会话页把它一直默认拥有的三样东西交出来，重审之后它们的现状是：

- **状态**。Session 行上的 `status`（`idle` / `running` / `compacting`）只有一个来源：`SessionManager` 里那条 entry。它随 Task 起止翻转，经 Session 通道的 `task_state` 与用户通道的 `session_state` 推到浏览器，侧栏的运行圆点与「未读」圆点都从它推导。一个不由 `SessionManager` 驱动的 Session 在这条链路上永远是 `idle`。
- **前端 UI**。前端的槽（页面、Agent 设置页签、Session 页签）已经在服务端声明（`WebShell`），`GET /api/contributions` 也已经把贡献作为数据返回，前端还有一个按名字查渲染器的注册表和把远端页面并进本地清单的 `mergePages`——但前端**从不请求**这个端点：注册表只服务于本地 `module.json`，`mergePages` 没有调用者。也就是说门开了一半：服务端能说，前端不听。
- **新建对话**。侧栏与折叠栏的「新建对话」都硬连到草稿页（`/chat/new`），草稿页只会建一个 OmniMessage 对话：选模型、选 Workspace、发第一条消息。没有任何地方能让插件在这里插一个入口。

这三样合起来就是「会话表面」。把它们做成一个概念、一条贡献，而不是三个各自为政的补丁，是因为它们总是一起出现：一种新的对话形态，要有自己的状态来源、自己的渲染、自己的创建入口。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**给使用者。** 装了 `claude-code` 插件（运营者在插件页把它列进部署清单，重启后生效——与其他插件一样，构建自带不等于安装）之后，侧栏「新建对话」下面多一行「Claude Code」。点它进入草稿页：选 Agent、选 Workspace，可以先写一句话作为第一条提示，然后「打开」。会话页此时不是消息流和输入框，而是一个终端，里面跑着 Claude Code 的 TUI，工作目录就是这个 Workspace。Claude 在思考时侧栏的圆点像普通对话一样转；它停下来等你时圆点变成「有新内容」的样子。这个对话和别的对话并排列在侧栏里，一样能改名、归档、删除；关掉浏览器再回来，终端还在，接着用。

**给插件作者。** 一种表面就是模块清单里的一条贡献加上它的代码半：

```json
{
  "penguin": {
    "modules": [
      {
        "name": "ClaudeCode",
        "requires": {
          "terminals": { "iface": "@prismshadow/penguin-server#Terminals", "from": "TerminalModule" }
        },
        "contributes": {
          "SessionSurfacesModule.surfaces": [
            {
              "id": "claude-code.surface",
              "kind": "claude-code",
              "label": "Claude Code",
              "renderer": { "builtin": "TerminalSurface" }
            }
          ]
        }
      }
    ]
  }
}
```

```ts
const plugin: Plugin = {
  modules: {
    ClaudeCode: {
      create: ({ use }) => ({
        api: {},
        bind: { "claude-code.surface": claudeCodeSurface(use.terminals as Terminals) },
      }),
    },
  },
};
```

`kind` 是这种表面的键（写进 Session 行），`label` 是「新建对话」里那一行的字，`renderer` 是前端用来画它的东西——`builtin` 指前端注册表里的名字，`iframe` 则由插件自己出页面。代码半实现 `SessionSurface`：`open` 在 Session 打开时被调用一次（幂等：已经开着就还是它），返回渲染器要的视图数据；`status` 回答这个 Session 现在是空闲还是运行；`close` 在 Session 删除或用户主动关闭时收尾。表面自己决定「运行」是什么意思——对一个跑在 pty 里的程序，是「最近一小段时间里有输出」。

**给前端。** 会话页不再假定每个 Session 都是对话。它看 `SessionInfo.surface`：为空就是今天的对话页；否则去表面清单里找这一种，用它的渲染器画整块内容区（工具条与停靠面板照旧）。表面清单从 `GET /api/contributions` 来，登录后取一次；同一响应里的 `pages` 也终于被并进路由——一个推送上来的平台或一个插件贡献的页面，只要前端有它的渲染器，就能打开。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 数据

- `sessions` 表新增 `surface TEXT`，`NULL` 即内建对话（存量行全是 `NULL`，语义不变）；`SessionRow.surface` 与 `SessionInfo.surface` 对应，仅在非空时出现在 DTO 里。该列**同时**走两条轨道，缺一不可：`openDatabase` 的 `ensureColumn` 声明式清单（进程启动时），以及一条 `swapSafe` 的编号迁移（`sessions-surface`）。迁移是要紧的那条——声明式清单只在**进程**启动时跑，而热推送从不重启 runtime（见 hmr/platform.ts 的 `migrate(caps.db, { swapPath: true })`）：没有它，被推上去的平台会把 `surface` 写进一张没有该列的表，于是每一次 session 写入都失败（新建、fork、子智能体登记，以及会话列表补水所走的 Trace 收编）。迁移的 `down` 有意写成空操作而非 `DROP`：删列会丢弃每个表面 Session 是哪一种表面。旧平台推回到已加列的数据根上只是看不见这一列。
- **表面 Session 不带模型引用，也不建 core Session**：`provider` / `model_id` 存空串，`SessionManager` 从不 adopt 它，也就从不驱动它——Task、压缩、审批、steer 对它一律 409（`session_not_found` 之外的路径本来就以 entry 为前提）。它在其他方面就是一个 Session：列表、改名、归档、删除、按 Workspace 分组都照旧；删除时额外调用表面的 `close`。
- `POST …/sessions` 接受 `surface`（必须是当前进程装载的一种，否则 400 `unknown_surface`）；有 `surface` 时忽略 `modelId` / `provider`，Workspace 校验不变。

### 服务端

- 词汇在 SDK 的类型面（`@prismshadow/penguin-core/plugin`）：`SessionSurfaceContribution`（`kind` / `label` / `labelZh?` / `renderer`）、`SessionSurface`（`open` / `status` / `close`）、`SurfaceSessionRef`（`sessionId` / `projectId` / `agentId` / `workspace` / `ownerUserId`）、`SurfaceOpenOptions`（`prompt?` / `cols?` / `rows?`）、`SurfaceView`（`alive` 加渲染器读的 `view` 文档）。
- 槽 `SessionSurfacesModule.surfaces: Slot<SessionSurfaceContribution, SessionSurface>`，归会话运行时组里的新节点 `SessionSurfacesModule` 所有；它 provides 机制 `SessionSurfaces`（`list` / `has` / `statusOf` / `open` / `view` / `close`）。同种 `kind` 出现两次是启动错误（点名两个插件），因为 `kind` 是写进数据的键，不能像语法高亮那样「后来者赢」。
- 状态：`SessionService.toInfo` 对 `surface` 非空的行改问 `SessionSurfaces.statusOf`；表面用 `open` 时拿到的 `report(state)` 回调上报翻转，`SessionSurfacesModule` 把翻转发成用户通道的 `session_state`（形状不变），并在进入 `running` 时 `markDriven`、回到 `idle` 时 `touchLastActive`——侧栏的「运行」与「未读」圆点因此不需要知道表面的存在。表面 Session 没有 Session 通道的 `task_state`，前端也不为它打开 SSE 流。
- 路由（会话运行时组，`/api/sessions/:sessionId/surface`，登录且有 Project 访问权）：`GET` 回 `{ kind, status, opened, alive, view }`（从未打开时 `opened: false`）；`POST { prompt? }` 打开或复用，回同一形状；`DELETE` 关闭。非表面 Session 一律 404 `not_a_surface_session`。
- `GET /api/contributions` 多一个 `sessionSurfaces` 数组（清单数据加 `id` / `from`），由 `WebModule` 从 `SessionSurfaces.list()` 读——同一来源，不另设一个槽。
- 终端：`CreateTerminalRequest` 新增 `command?: string[]` 与 `env?`——有 `command` 时 pty 直接运行它（argv 原样，不再加 `-l`），`shell` 与之互斥。仅在 `Terminals` 机制上，不经 HTTP 暴露：表面插件需要的是「在 Workspace 里跑一个程序」，不是给浏览器一个任意 exec。
- 热更新：插件模块每个 App 重建，pty 经资源注册表存活；表面在 `park()` 里记 `sessionId → terminalId`，重建时按 id 从 `Terminals.get` 认领回来，认领不到就当作从未打开。

### 前端

- `ContributionsProvider` 在 `RequireAuth` 内登录后取一次 `GET /api/contributions`；`useContributions()` 给出 `sessionSurfaces` 与合并后的页面表。路由改从合并后的表生成（`mergePages` 的第一个调用者）；导航栏仍只列本地页面——贡献页面的标签与图标没有来源，这一步留待页面贡献带上自己的标签时再做。
- 渲染器注册表分两张：页面的（既有）与表面的。表面注册表首个成员是 `TerminalSurface`：挂载即 `POST …/surface`，把返回的 `view.terminalId` 交给 `TerminalView`（与停靠栏的终端同一组件，同一 WebSocket 协议）；退出后显示退出码与「重新打开」，再 `POST` 一次即重新生成。`iframe` 渲染器把 `src` 里的 `:sessionId` 换成实际 id。
- 会话页：`selected.surface` 非空时，内容区渲染表面而不是消息流与输入框；`useSessionStream` 收到 `null` id（不开流）；工具条的模型相关控件对表面 Session 不出现。
- 新建对话：侧栏与折叠栏在「新建对话」之下为每种表面各加一行（`label`，中文界面下取 `labelZh`），点击进入草稿页并带路由状态 `{ surface }`。草稿页在表面模式下把输入卡换成一行提示与「打开」按钮，Agent 与 Workspace 的选择照旧；「打开」= 建 Session（带 `surface`）→ `POST …/surface { prompt }` → 跳转。提示文本作为第一条提示交给表面（`claude-code` 把它作为 `claude` 的初始参数）；为空则只打开。

### `claude-code` 插件

- 包 `@prismshadow/penguin-plugin-claude-code`（`plugins/claude-code`），一个模块 `ClaudeCode`，requires `Terminals`，贡献一种表面。`open` 以 `command: [claudeBin, ...(prompt ? [prompt] : [])]` 在 Workspace 里建 pty；`claudeBin` 取环境变量 `PENGUIN_CLAUDE_BIN`，缺省 `claude`（这也是集成测试替换成假程序的缝）。
- 运行状态是启发式：pty 有输出即 `running`，静默超过一个固定窗口回到 `idle`，退出即 `idle`。Claude Code 工作时持续重绘（spinner），等待输入时不重绘，所以这条规则在实践里对得上；它是**这个插件**的判断，不是平台的——第二个 pty 表面出现时再考虑把「pty 活动即运行」提到平台层。
- 构建自带（`scripts/build-plugins.mjs` 与其他 `plugins/*` 一样打包）、列入内置索引（`builtin-index.json` + README），**不在 `plugins.json` 里**——装不装由运营者决定，这正是「默认不启用」在现有机制下的准确含义。

### 插件集成测试框架

- 包 `@prismshadow/penguin-plugin-test`（`packages/plugin-test`）。`startHarness({ plugins, ... })` 在临时数据根里写 `plugins.json`（每个插件以其入口文件的绝对路径列出——loader 的直接 `import` 路径，清单从入口向上找 `package.json#penguin`），以子进程启动**真实的服务端**（`@prismshadow/penguin-server` 的构建产物，`PENGUIN_HOME` 指向临时根、随机端口、种子管理员密码固定、插件索引关闭），等到 `/api/install` 应答即返回 `Harness`：`baseUrl`、`root`、`admin`、带 Cookie 的 `api`（`login` / `get` / `post` / `put` / `delete`）、`stop()`。
- 走真实 loader 而非进程内装配是有意的：插件作者要验证的正是「我的包能被这台服务端解析、装载、进树」，进程内装配绕过了这一半。
- 附带两个常用助手：`installedPlugins()`（读 `/api/plugins/installed`，断言 `active`）与终端助手（`capture` / `keys`，对着 `/api/terminals/:id`）。`claude-code` 的集成测试用它：以一个假 `claude`（先打印、再「思考」一秒、再等输入）跑完「新建表面 Session → 打开 → 状态 running → 回到 idle → 关闭」整条链。
- 它是开发依赖，不进任何发行物。

### 兼容性

`sessions.surface` 为追加列，无需用户动手；存量行读作内建对话。它经一条 `swapSafe` 编号迁移抵达存量数据库，因此**热推送**（不重启进程）也能长出该列——这是它必须是迁移而不只是 `ensureColumn` 的原因。`GET /api/contributions` 只增字段。旧运行时上推送新平台：`SessionSurfacesModule` 是平台内的节点，与运行时无关。

## Drawbacks
[drawbacks]: #drawbacks

- 表面 Session 是「没有模型的 Session」，`provider` / `model_id` 存空串是一处妥协：这两列 `NOT NULL` 且被成本中心按 `(provider, model_id)` 分组——表面 Session 没有用量记录，所以不会出现在那里，但任何新读者都得知道空串的含义。
- 运行状态对 pty 表面是启发式，窗口常量选得不好就会闪烁或迟钝；它没有「压缩中」这类中间态。
- 前端多一次登录后的请求，路由表从静态变为依赖一次拉取（拉取前只有本地页面，与今天相同）。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **只做终端、不做 Session**：让「Claude Code」只是停靠栏里的一个终端页签。做起来最省，但用户要的正是它出现在对话列表里、有自己的状态圆点、能被归档删除——这些都是 Session 的属性，不是终端的。
- **只用 iframe**：插件自己出整页 UI，前端不加渲染器。终端渲染需要 xterm、WebSocket 协议、触屏键盘条，全部在前端已经有；让每个 pty 表面再带一份是浪费，而且 iframe 里的键盘焦点与快捷键会与外层打架。`iframe` 仍然保留，给不是终端的表面。
- **把状态放进 `SessionManager`**：给它加一个「外部状态源」。`SessionManager` 已经很大，而且它的 entry 与 core Session 绑死；表面 Session 根本没有 core Session，硬塞进去只会多出一堆 `entry.session` 为空的分支。改在 `toInfo` 处分流，`SessionManager` 不用知道表面。
- **把 pty 活动检测放进平台**：现在只有一个 pty 表面，规则放在它自己身上最诚实；平台层的抽象等第二个用例出现再提。
- **什么都不做**：会话页继续只认对话，Claude Code 只能在停靠栏的终端里手动敲 `claude`，插件做不了任何事——这正是被要求解决的问题。

## Prior art
[prior-art]: #prior-art

- VS Code 的自定义编辑器（Custom Editor）：一个资源可以由扩展提供的编辑器打开，编辑器在 `package.json#contributes.customEditors` 里以数据声明，代码在扩展里；宿主决定何时创建、何时销毁。表面与之同构：Session 是资源，表面是编辑器。
- `@vscode/test-electron`：下载并启动真实的 VS Code、装上开发中的扩展、在里面跑测试。`penguin-plugin-test` 是同一个想法在服务端的形状。
- 本仓库的语言插件与沙盒插件：同一道门（清单数据 + `bind` 代码），本篇只是为会话页再开一个槽。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- pty 表面的静默窗口取多长；是否需要让表面报告除 `idle` / `running` 以外的状态。
- 表面 Session 能否建在其他 Machine 上（当前只在本服务端：Workspace 在哪台机器，pty 就得在哪台）。
- 贡献页面的导航标签与图标从哪里来（本篇只把它们并进路由）。

## Future possibilities
[future-possibilities]: #future-possibilities

- 同样的表面契约装下别的 TUI 智能体（Codex CLI、Gemini CLI）：各是一个几十行的插件。
- 「pty 活动即运行」提为平台层的 pty 表面助手，插件只给 argv。
- 表面在 Machine 上打开，走终端中继。
- `penguin-plugin-test` 加浏览器一层（Playwright 对着 harness 的 `baseUrl`），把表面的渲染也放进插件自己的测试。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
