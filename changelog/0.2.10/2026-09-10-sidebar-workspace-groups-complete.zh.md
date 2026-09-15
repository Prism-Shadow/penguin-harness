# 侧边栏列出全部工作区,而不只是首页触及的那几个

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#663](https://github.com/Prism-Shadow/penguin-harness/pull/663)

[English](2026-09-10-sidebar-workspace-groups-complete.md)

按 Workspace 分组时,侧边栏只为已加载行所属的 Workspace 成组,而初始加载只取每个 Agent 最新的 10 条对话。几十个 Workspace 各有几百条对话时,最新对话排不进某个 Agent 前 10 名的 Workspace 就根本不出现。现在分组清单同时取自服务端按 Workspace 细分的计数:凡持有 Session 的 Workspace 都成组,并按各自最新 Session 的时间就位,不论其行是否已加载。

## 细节

- 会话列表 `counts=1` 的响应在 `workspaceCounts` 之外新增 `workspaceLatest`:每个 Workspace 路径最新 Session 的 `createdAt`,在同一趟最新优先的遍历中取得。
- 仅由计数得知的组先以空组出现,所在的分组页上屏时沿本组流拉取自己的首页,与既有各组补齐缺行的做法一致。首页在途时该组显示加载骨架而非「暂无会话」;拉取失败则保留「更多」行作为重试入口。
- 排序取组内最新已加载行与服务端时间戳中较新者,临时工作区合并组恒在最后,手动添加的空工作区殿后——行到达时组不会挪位。
