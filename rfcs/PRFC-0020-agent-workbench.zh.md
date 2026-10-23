# PRFC-0020 Agent Workbench：应用命名、插件分发与产品支持

[English](PRFC-0020-agent-workbench.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0020-agent-workbench.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `agent_workbench`
- Start Date: 2026-10-14
- PRFC PR: [Prism-Shadow/penguin-harness-design#331](https://github.com/Prism-Shadow/penguin-harness-design/pull/331)
- Implementation PR: [Prism-Shadow/penguin-harness#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)
- Status: 实现 PR #1133 已于 2026-10-14 合并到 main。

## Summary
[summary]: #summary

原 Workflow 能力改名为 **Agent Workbench**：一个 Agent 拥有的应用，由服务端模块、清单贡献的页面和持久状态组成。应用可由 Agent 在自己的目录里编写，也可由 Plugin 分发。默认 Project 通过 `penguin-support` 插件供给 PenguinHarness Support，用户在问题列表里提问与追问。目录、接口、路由、事件和样式采用 Workbench 名称，已有应用经一次性迁移保留状态与历史。

本文承接已合并的 [PRFC-0014](PRFC-0014-workflow.md)，记录实现 #1133 的变更。模块树、源码检查与失败后保留上一实例的基础机制沿用原设计。

## Motivation
[motivation]: #motivation

这些页面承载持续使用的应用：用户选择 Agent 后直接打开页面，通过表单、列表与按钮驱动任务。Workbench 统一界面和开发接口中的称谓。只允许 Agent 现场编写源码会让产品支持这类可复用应用重复生成；经既有插件链路安装，应用与其指导 Skill 可以一起分发、检查更新和移除。

应用启动一轮 Agent 任务后需要读出结果。仅有 `sessionStatus` 无法区分成功回答与无答案结束，也不能让页面恢复之前的提问。应用因此保存 Session id，并读取最近一轮主任务的结果。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

- 首页 AI 应用示例要求创建专属 Agent 与 Workbench。用户选择这个 Agent，打开新对话草稿就能切到应用标签，无须先发送消息。切换示例时替换预选 Skills。
- 应用源码位于 `<agentDir>/workbenches/<id>/`，与 `agent_state/` 平级。`package.json` 声明模块及标签页，`index.ts` 实现后端，`ui/` 放 HTML、CSS、JavaScript；只有静态文件而没有标签贡献时不显示页面。
- 后端用 `host.createSession` 和 `host.run` 发起任务，用 `host.setState` 保存 Session id，再通过 `host.sessionResult` 轮询。上传文件与生成报告放在源码监视范围之外，下载使用服务端附件链接。
- 保存源码会重载应用；失败时旧实例继续服务，`.build/status.json` 给出错误与提示。历史加载失败提供重试，恢复代码版本不恢复旧的运行数据。
- Agent 设置的工作台标签页可打开、重载、恢复版本和移除应用；Agent 卡片与可搜索的 Agent 选择弹窗显示工作台数量。新对话只显示当前所选 Agent 的应用，切换 Agent 后不沿用前一个 Agent 的标签。
- 标签页可占满应用；悬浮退出按钮与命令面板返回原对话路径，并重新选中原工作台标签。直接打开全页地址时，退出后在该 Agent 的新对话中选中同一工作台。既有 `/app/<project>/<agent>/<id>[/<tab>]` 和 `penguin web --app` 地址形状保持稳定。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 名称与边界

| 对象 | Workbench 契约 |
| --- | --- |
| 源码 / 历史 | `<agentDir>/workbenches/<id>/`、`<agentDir>/workbenches-history/<id>/` |
| 根模块 / 类型 | `Workbench`、`WorkbenchPackage`、`WorkbenchHost`、`WorkbenchMain` |
| 平台机制 | `Workbenches`、`WorkbenchService`、`WorkbenchRoutes` |
| 标签贡献 | `WebModule.sessionTabs`；由应用清单提供 `id`、`key`、`title`、可选 `titleZh` 与 renderer |
| 样式 | `/workbench-ui.css`、`--wb-*` 变量与 `wb-*` 类；共享样式遵守 HTML 的 `[hidden]` |
| 更新 / 删除事件 | `workbench_updated { projectId, agentId, workbench }`、`workbench_removed { projectId, agentId, workbenchId }` |

槽名沿用 #1133 的 `WebModule.sessionTabs`；[设计 PR #317](https://github.com/Prism-Shadow/penguin-harness-design/pull/317) 的 WebApp 模块改名属于另一项在途工作，不在这里提前改成新的槽名。

HTTP 前缀为 `/api/projects/:projectId/agents/:agentId/workbenches`，按已有 Project 访问规则鉴权：

| 方法与后缀 | 行为 |
| --- | --- |
| `GET /` | 列出应用并加载变化的源码 |
| `POST /:id/reload` | 重载 |
| `GET /:id/history` | 读取版本列表 |
| `POST /:id/rollback` | 按 `{ revision }` 恢复源码并重载 |
| `DELETE /:id` | 移除应用 |
| `GET /:id/ui/*` | 提供界面静态文件 |
| `ALL /:id/api/*` | 调用后端处理器 |

`WorkbenchMain.handle` 处理 JSON、非 JSON 请求字节及可选的二进制或流式响应。`WorkbenchHost` 提供 Project 内的 Agent 列表、Session 创建与运行、状态、标题、最近结果，以及应用自身的状态读写与日志。`run` 接受非空的 `{ text }` 列表，作为 `sender = server` 的用户文本交给 Agent，忙时排队；在任务启动或排队后返回，不等待完成；`sessionResult` 返回 `{ status: running | completed | failed, text, error }`，只读取最近一轮主任务的最终回答或失败，不把工具、思考、子会话输出或此前答案当作当前结果。运行中的空文本不等于失败；空闲且本轮没有最终回答时返回 `failed`，不回退到旧答案。宿主只能访问同一 Project 的 Session；新建时可选择该 Project 内的 Agent，审批模式固定为 `allow-all`，与无人值守任务一致。

宿主新建的 Session 写入 `session_meta.source = workbench`，索引行写入 `client = workbench`；尚未运行、没有 Trace 的行也据此识别来源。已有 Trace 的来源优先于索引行，不能把旧 `user` 会话重新标为 `workbench`。此类会话默认列入「已归档对话」，归档筛选支持 `source=workbench`，应用仍可读取和运行；用户取消归档后留在侧栏并显示工作台来源标记，后续运行不再自动归档。来源不随归档动作改变，已有 Trace 不因应用更名而改写。

`AgentSummary.workbenchCount` 统计名称合法、目录下存在 `package.json` 文件的应用，不解析清单是否合法，因此包含清单错误或构建失败的应用；列出 Agent 时不为取得数量编译应用或遍历全部资源。

并发读取同一应用修订共用一次加载。首次列出时即开始发现应用：目录尚未创建则定期重查，出现后切到源码监视；首次创建应用不依赖恰好收到文件事件。开发入口 `tsx watch` 排除配置的数据目录及其规范化绝对路径，应用源码由 Workbench 自身的监视器处理；写入 `.build/` 不应重启整个服务端。

### 插件携带应用

插件包的 `workbenches/<name>/` 携带源码，经过插件库读取、zip 导入校验、Agent 安装、更新检测、文件浏览与卸载；只含 Workbench 的包也是插件库插件。库内形态为 `LibraryWorkbench { name, version, files }`；名称符合 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`，清单须声明非空的 `penguin.modules` 和 `YYYY.MM.DD.N` 版本，不得携带 `state.json`、隐藏文件或 `node_modules`，无效应用告警并略过。应用自己的 `package.json#penguin.version` 使用日期版本，已装副本通过 `.plugin.json` 记录插件归属与文件清单；回滚后按当前源码版本判断是否落后。Plugin 的 npm 版本与应用的日期版本分别负责包发布和已装副本更新。

安装前检查整次请求中的名称冲突：同名应用属于其他插件或由用户手写时以 `409 workbench_name_taken` 拒绝（仅有 `state.json` 的恢复目录允许接续安装），不在写入部分 Skill 或配置之后才报错。写入按文件原子替换，拒绝源路径越界或通过符号链接父目录写出应用目录，不承诺整批写入的事务回滚。首次写源码前先记空版本的归属记录，失败后同一插件可重试且仍显示待更新；全部完成后才写最终版本与文件清单。同一插件更新替换其源码、移除旧清单中不再存在的源文件，保留 `state.json` 与版本历史；清除其生成的 `.harness/`，由下一次加载按当前宿主生成类型。手写应用仍保留自己的接口依据。从 Agent 卸载时，只对安装记录仍归属该插件的应用调用删除接口；删除会移除整个应用目录（含 `state.json`）及其历史。保留状态与历史的保证适用于更新和代码回滚，不适用于删除应用。

`GET /api/plugins` 的应用 metadata 只含名称与版本；`GET /api/plugins/:plugin/files` 提供清单与源码。Agent 级 `GET …/agents/:agentId/plugins` 与安装 `POST` 同返 `{ skills, hooks, mcpServers, workbenches? }`，应用项为 `{ name, plugin, version }`；读取 MCP 配置失败不阻止返回文件中的已装内容。已安装判据覆盖插件的全部部件及应用归属，更新判据按每个部件的日期版本比较，汇总版本取其中最新者。插件库页按内容分组、文件预览、更新确认和卸载均包含 Workbench；从服务端删除插件包不删除各 Agent 已装副本。

### PenguinHarness Support

每个 Project 仍提供 `default_agent`；默认 Project 另提供不可从 Web 删除的 `penguin_support`。内置 Agent 的供给流程幂等，已有 Agent 不被预设覆盖。该 Agent 安装 `penguin-support` 插件，Skill、后端与页面都来自插件包，不在初始化代码中复制另一份应用。

页面为居中的可搜索问题列表。新问题与详情在对话框中打开；新问题只需正文，标题读取关联 Session 的标题并跟随改名。问题与回复持久化，支持追问、重试、解决和重开。点击对话框外部可关闭，未提交草稿保留。运行中显示已用时间与预计等待，超过估计时改为明确的超时估计说明；空 API 响应显示可读错误并保留草稿。答案使用行内编号来源链接。Skill 复用 Agent 级参考仓库检出，检索时兼顾历史 Workflow 名称。

应用构建 Skill 要求列表与详情分开、对话框具备可访问的名称及焦点管理，并提供任务进度反馈；浏览器验收使用两条独立对话确认记录和结果不会串联。

### 一次性迁移

首次访问时，把旧 `workflows/` 与 `workflows-history/` 转为新目录；先在暂存副本中转换模块、接口、路径和样式引用，重新计算历史修订，再发布。`state.json` 字节不变，原件留在 `<agentDir>/.workbench-migration/backup/`。发布中断后下一次访问续行；目标冲突或历史无效时停止，不覆盖原文件。

外部调用方须改用 `/workbenches` 与新事件名，不保留旧 API 别名。应用 id、全页地址、已经发布的教程及媒体 URL 保持稳定。迁移由 Workbench 维护者保留到 0.2.x 结束；最低支持的数据版本升至 0.3、无需再从 Workflow 构建升级时移除迁移代码。备份留在磁盘供恢复，不随代码移除自动删除。此处记录 #1133 已有的兼容方案，不另引入双格式长期运行。

## Drawbacks
[drawbacks]: #drawbacks

外部 API 调用方需要修改名称，迁移代码在支持旧数据期间需要维护。插件更新会替换已装应用的源码，用户自己的修改需要通过历史恢复。后端仍在服务端进程内运行，页面仍为同源 iframe；本次更名与分发没有改变执行隔离边界。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

复用 Plugin 安装机制使 Skill 和应用具有同一归属，避免预设初始化与插件更新维护两套源码。运行状态独立于源文件版本，更新或回滚应用不会抹掉已有问题。一次性转换把旧命名集中在迁移入口；永久保留两套接口会让所有后续变更同时维护旧路径。

## Prior art
[prior-art]: #prior-art

[PRFC-0001](PRFC-0001-module.md) 提供模块与接口边界，[PRFC-0003](PRFC-0003-plugin.md) 提供插件装配；[PRFC-0014](PRFC-0014-workflow.md) 记录 Workflow 的独立模块树、类型检查、标签贡献与源码历史。本文在这些机制上补上应用命名、分发、结果读取和内置支持入口。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

后端执行隔离与 iframe 权限仍由原 Workflow 设计的未决项跟踪。本次不承诺扩大隔离。

## Future possibilities
[future-possibilities]: #future-possibilities

其他可复用的 Agent 应用可按同一插件约定分发；新增宿主方法或 UI 槽另行设计，不由本次改名自动开放。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
