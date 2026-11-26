# Agent 工作台页面把位置记在地址里

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `web`, `docs`, `plugins`

[English](2026-11-26-workbench-frame-protocol.md)

所有 Agent 工作台的窗口与整页都用上了服务端模块的 iframe 系统应用已有的位置协议：地址里的 `at`，以及 `penguin:location` 与 `penguin:navigate` 两种消息。设计见 penguin-harness-design [#619](https://github.com/Prism-Shadow/penguin-harness-design/pull/619)。

## 细节

- **地址**：窗口 `/apps?app=<agentId>/<workbenchId>` 可带 `&at=<页面内的路径与查询串>`；机器上的应用在键中保留 `<machineId>:` 前缀。整页 `/app/<projectId>/<agentId>/<workbenchId>[/<tab>]` 同样带 `?at=`。
- **位置**：iframe 的 `src` 以片段（`#<at>`）带上初始的 `at`。页面发出的 `{ type: "penguin:location", at }` 替换地址里的 `at`，不新增历史记录。地址在宿主一侧得到新的 `at` 时（后退、前进或粘贴地址），宿主向页面发同样的消息，不重载 iframe。不带 `at` 的地址（例如图块或侧栏）让运行中的窗口回到页面所在的位置。
- **导航**：页面发出的 `{ type: "penguin:navigate", to }` 使窗口最小化，并把用户带到 `to`。宿主只接受同源的应用路径（以单个 `/` 开头、不在 `/api/` 下），且消息须来自该窗口自己的 iframe；窗口已最小化时忽略。
- **全屏**：从窗口打开全屏——侧栏行菜单的「全屏」或页面自己的 `penguin:fill-app`——都在页面所在的位置打开整页。整页把页面的换页记在自己的 `?at=` 里，退出时回到窗口中页面已到的位置。
- **多个页面**：有多个页面的工作台切换到另一个页面时，该页面从根开始，地址中的 `at` 随之去掉。
- **上下文**：工作台 iframe 的根元素在加载时与每次变化时写入 `lang` 与 `data-project-id`，与贡献页面的 iframe 一致。
- 两种消息都不发的工作台行为不变；`penguin:fill-app` 与模型选择的消息不变。
- 系统应用与 Agent 工作台的窗口和整页改为共用这一协议的同一份实现。
- `penguin-plugin` Skill（版本 `2026.11.26.1`）以及文档的 Workbench 插件页与插件页为工作台作者说明了 `at` 与两种消息。
