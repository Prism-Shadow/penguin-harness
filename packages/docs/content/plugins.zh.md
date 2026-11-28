---
title: 插件
description: PenguinHarness 的插件是什么、插件包遵循的格式与校验方式、插件从哪里来，以及如何分享——经插件索引、npm 或本机链接。
---

插件是一组 penguin modules——harness 自身就是用它组装的单位（机制面见[服务端启动](/server-boot#插件是什么)与设计文档 PRFC-0001「Module」、PRFC-0003「Plugin」，仓库收录在 `rfcs/` 下）。插件是一个 npm 包。装上它，它的模块进入服务端的模块树，它的 Skill、钩子包、MCP Server 和 Workbench 进入 Agent 的 Agent State——围绕这些的操作见 [Skill 与插件](/skills#工作原理)。这一页讲包本身：它的格式、插件从哪里来、以及如何分享——经插件索引、npm 或本机链接。

## 格式

插件包是一个 npm 包，`package.json` 只带 npm 自己的字段。插件携带的内容在它的入口源码里声明：一个空类，其 `@Component` 装饰器把插件的卡片、Skill、钩子包、MCP Server 和 Workbench 作为贡献投给服务端的 `PluginLibraryModule`；默认导出 `{ modules, replaces }` 是它添加的服务端模块。包的构建对自己的 tsconfig 跑 `penguin-gen-ifaces`，把这份声明写进 `package.json` 旁边的 `ifaces.json`；服务端读取的就是这张表，从不运行包本身。逐字段的表格、目录布局与完整示例见[工作原理](/skills#插件文件格式)。

这些都是插件，同一份格式覆盖所有情况。不同的是包的内容装上后落在哪里：它投给 `PluginLibraryModule` 的贡献——Skill、钩子、MCP Server、Workbench、卡片——装上后进 Agent 的 Agent State，只带这些的包不需要代码入口（`goal` 插件是完整示例）；默认导出里列出的服务端模块——例如沙盒后端——装上后进服务端的模块树。一个包可以两者都有。内置插件还可以带上 Web App 与 CLI 在构建时编入的两半——`./web` 与 `./cli` 两个入口。`browser-automation` 全都带上了：Agent 浏览器的服务端模块、它的面板与设置页、`penguin browser` 命令，以及它的 Skill。

服务端模块需要的平台，至少要和它投稿的槽一样新。槽是具名的贡献点，例如路由组所在的 `HttpModule.routes`。每个槽、槽数据的每个字段，都随某个发行版本出现。较旧的平台不认识较新的槽，也不认识较新的字段（如路由组的 `origin`）。它的校验于是丢弃该模块投给这个槽的全部贡献：插件缺了这一部分照常运行，**插件**页上它那一行说明原因。内置插件随它运行的服务端一同发布。发布到 npm 的包在 README 里写明它需要的最低版本。

## 服务端模块能拿到什么

服务端模块只经 `@prismshadow/penguin-server/plugin` 接触宿主。它在 `@Use` 字段里写明要哪个接口，内核把它接到模块树里具备这些成员的节点上：按结构匹配，所以插件也可以在自己的包里声明同样的视图，只写它调用的成员。宿主里没有节点具备这些成员时，该插件不进入这一代，**插件**页说明它缺了哪项要求。较旧的服务端就是这样拒绝为较新版本构建的插件。

插件提供的系统应用所需（PRFC-0036）：

| 接口 | 成员 | 说明 |
| --- | --- | --- |
| `AppData` | `dataPaths(projectId, appId) → Promise<{ dataDir, cacheDir, stateDir }>` | 应用在一个 Project 中自己的文件夹：系统 Agent 以应用 id 为键的 agent 级文件夹（`agents/system_agent/app/{data,cache}/<appId>/`，状态文件夹在 `run/` 下），交出前即已建好。处理器用 Node 的 `fs` 读写。id 不是单个普通路径段时 `400`，服务端没有该 Project 时 `404` `project_not_found`，该 Project 的 `system_agent` 是用户自己的 Agent 时 `409` `system_agent_held`。 |
| `AgentTasks` | `start({ userId, projectId, agentId, prompt, approvalMode, skills?, model?, thinkingLevel?, title? }) → Promise<{ sessionId }>`、`status(userId, sessionId) → Promise<{ status, title, pendingApprovals } \| null>` | 以某个人的名义发起的 Agent 任务，步骤与 Web App 的「发送」相同：此人进不了该 Project 或 Agent 不存在时 `404`，系统 Agent `409` `system_agent_no_sessions`，新建临时 Workspace，Skill 以 `[use_skills]` 块放在正文之前，本轮的驱动者为此人，来源为 `user`（出现在其侧栏，带审批角标与完成通知），审批模式取给定的值。`status` 为 `running`、`completed` 或 `failed`，并给出任务在等的审批数；Session 已不在或此人读不到时为 `null`。发起任务的路由先检查 `requireHuman`。 |
| `Access` | `requireProjectAccess`、`requireProjectOwner`、`canAccess` 等 | 谁能看到、谁拥有一个 Project。 |
| `AgentSkills` | `installedSkills(projectId, agentId) → Promise<string[]>` | 一个 Agent 已装 Skill 的名称，按名称排序：即它的 `skills/<name>/` 中含 SKILL.md 的文件夹。Project 没有该 Agent 时 `404` `agent_not_found`。 |
| `ProjectModels` | `getModels(projectId)` | Project 的模型（密钥已遮蔽）与默认模型。 |
| `ProjectMachines` | `projectApis(projectId)` | Project 使用的机器，各带别名，连接时另带一个访问其 API 的客户端；同机器代理一样，只为管理员读取。 |
| `WorkspaceFiles` | `list`、`read`、`resolvePath` 等 | Workspace 的文件，沿用服务端对链接与大小的防护。 |

插件自己的路由所需的函数，以副本打包进插件：`containedFile(dir, rel)` 与 `uiFileResponse(c, file)` 从插件自己的文件夹提供页面文件，拒绝越界的路径与任何链接；`unzipBounded`、`assertSafeEntryPath`、`assertDistinctPaths`、`specialEntries` 与压缩包上限（`MAX_ARCHIVE_BYTES`、`MAX_ARCHIVE_FILES`、`MAX_FILE_BYTES`、`MAX_TOTAL_BYTES`）用于安全地读取上传的 zip。

系统应用可投稿的数据槽：

- `ProjectsModule.appSeeds` `{ app, path }`：新建 Project 时，包内 `<path>/` 下的每个文件夹以原名复制进该应用的 `dataDir`，名称已被占用的不动。宿主从 `ifaces.json` 读出这项声明并自行复制文件，只对内置包、只在创建时做一次：删掉的不再回来，已有的 Project 不会得到它们。
- `SemanticIdModule.kinds` `{ kind, access? }`，代码半为 `{ takenIds(projectId) }`：`POST …/suggest-id` 可提议的一种 id，kebab-case，避开 `takenIds` 报告的 id；`access: "owner"` 时仅限 Project 的所有者。
- `StartPageModule.metrics` `{ key, title, titleZh?, icon?, order, value, app? }`：开始页排在自带计数之后的一个计数，构建包时即已确定；`app` 为点击后打开的系统应用的页面键。`GET /api/contributions` 以 `startMetrics` 交出它们。

## 应用窗口中的页面

服务端模块经 `WebModule.pages` 为 Web App 贡献页面。以 iframe 渲染（`renderer: { iframe: { src } }`，`src` 由模块自己的路由提供）、带 `title` 与 `app: { order }` 的页面是系统 Agent 的系统应用：它的图块在应用中心，点开后与 Agent 的应用一样在应用中心的窗口中运行——最小化后继续运行，全屏以无窗口外框的整页绘制同一个文档，关闭即结束。

- **地址**：窗口为 `/apps?app=system_agent/<页面键>`。页面自己的位置记在 `at`，即应用内的路径与查询串（URL 编码）。iframe 的 `src` 以片段（`#/<路径>?<查询串>`）带上初始位置。不带 `at` 的地址（例如点图块）让运行中的窗口回到页面当前所在的位置。
- **旧地址**：页面的 `path` 及其下的每个地址都打开窗口，并替换历史记录中的当前项：`/reports/r1?tab=a` 即 `/apps?app=system_agent/reports&at=%2Fr1%3Ftab%3Da`。
- **消息**（`postMessage`，同源）：
  - `{ type: "penguin:location", at }` 双向。页面在内部每次换位置都发它，宿主替换 `at` 而不新增历史记录，所以页面应以 `history.replaceState` 而非 `pushState` 换位置；宿主一侧的地址改变时（后退、前进、粘贴地址），宿主向页面发同样的消息，页面不重载即前往该处。
  - `{ type: "penguin:navigate", to }` 请宿主前往 `to`，须是本应用不在 `/api/` 下的路径，例如 `/chat/<sessionId>`；窗口随之最小化并继续运行。
  - 宿主只接受来自自己窗口中那个 iframe 的消息；页面也应只接受来自 `window.parent` 的消息。
- **上下文**：iframe 的根元素带 `lang`（`zh-CN` 或 `en`）与 `data-project-id`，界面语言或当前 Project 改变时随即更新；它们与宿主写进每个工作台页面的主题并列。iframe 自己不绘制底色。

Agent 工作台的页面沿用同样的地址、消息与上下文，在它的窗口（`/apps?app=<agentId>/<workbenchId>&at=…`）与整页（`/app/<projectId>/<agentId>/<workbenchId>[/<标签键>]?at=…`）中都是如此，见 [Workbench 插件](/skills#workbench-插件)。

不带 `app` 的贡献 iframe 页面在它的 `path` 上以整页打开，iframe 的规则相同。安全模式不绘制任何服务端贡献，这样的应用因此不出现。

## 校验格式

没有哪一步靠「跑一遍插件包」来判断它是什么：表说了算。两处检查读这张表和它周围的包，读到的是同一份生成的文件，所以结论一致：

- **索引仓 CI**检查提交的包：清单可解析、路径拼出它的名字、版本与内容哈希；元数据与 npm 所服务的相符；按 lock 安装得到的正是哈希指向的内容；包是可装载的 ESM 且带 `activate` 导出；许可证在允许清单。这些是提交协议的规则，[CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md)（插件索引仓库）是它们的权威。
- **本地**，构建包（`penguin-gen-ifaces` 重新生成 `ifaces.json`，过期的表会被具名拒绝），再按服务端的方式装载一次——在部署上走 Project 的 `[plugins]` 表，或走测试所驱动的装载器。声明与表对不上、或表不是构建写出来的包，会被跳过并报告原因。

## 插件从哪里来

四个来源，四条规则：

1. **harness 自己的模块**不是插件作者要列出或提交的东西：它们多数住在主包里，能独立出来的功能会移进 `plugins/` 下的内置插件——Agent 浏览器是第一个，即 `browser-automation`——但无论在哪里，它们都是 PenguinHarness 的组成部分，不是别人的包。今天的包布局见[架构](/architecture)。
2. **builtin plugins**随仓库 `plugins/` 目录发货——一个插件一个 npm 包，按分类列在[内置插件库](/skills#内置插件库)。安装它从 npm 或它的仓库取包，桌面应用把自己的一组插件直接打进安装包。围绕他人产品打造的插件带 `use-` 前缀（`use-firecrawl`），自进化工具包的名字以 `-rsi-toolkit` 结尾。
3. **third-party plugins**收录进[插件索引](https://github.com/Prism-Shadow/penguin-harness-plugins)——一条 PR 一个条目，走那个仓库自己的收录协议。服务端在**插件**页把索引与内置清单合并；索引只管发现，包仍从条目指名的渠道安装。
4. **自己的或未收录的插件**不需要索引：用 `penguin plugin link` 把本机目录链接进服务端的插件前缀——目录留在原地、原位引用，与安装的插件走同一条装载路径；已发布的包也可按 npm 名直接装。

## 分享插件

插件索引仓库的 [CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md) 是收录协议的权威；本页与 `penguin-plugin` 技能指向它、不复述它的规则——两者与它不一致时，以它为准。简述：先发布包（npm 就是渠道的全貌——条目至少要有一个 harness 能取到压缩包的来源，字节由条目的哈希钉住），让工具写条目（`pnpm new-entry <name>@<version>`），填 `categories` 与 `owners`，跑本地检查，然后开一条恰好带一个条目的 PR。CI 决定机械问题；评审是人。

`penguin-plugin` 技能把同样的步骤带进 harness 会话，并连同另外两条路——按 npm 名安装、或链接本机目录——以及分享前测试一个包的方法（用 `PENGUIN_HOME` 起独立实例、`penguin plugin link` 链进插件前缀）：它驱动协议而不复制协议，两者在同一次改动里一起更新，步骤版永不偏离它驱动的规则。
