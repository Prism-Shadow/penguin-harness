# Session 可以从 CLI 和会话内部重命名

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `web`, `docs`
- **Issue:** [#813](https://github.com/Prism-Shadow/penguin-harness/issues/813)

[English version](2026-10-09-session-rename.md)

Session 的标题是它的所有者用来找到它、把它和其他会话区分开来的标签；在此之前，程序只能从 Web App 设置它。`penguin session rename <title> [session_id]` 可以从 CLI 重命名 Session，`penguin run --title <title>` 在 `run` 创建或复用 Session 的那一刻就给它命名，新的 `rename_session` 内置工具则让正在运行的 Agent 在收到要求时重命名自己的 Session，或同一 Project 内的另一个 Session。三条路径都走既有的 `PATCH /api/sessions/<id>` 端点，使用同一套校验。

## 细节

- **Core** 在 Environment 上定义了 `SessionControl` 服务，像 `controlEnv` 一样，从新增的 `CreateAgentOptions.sessionControl` 宿主回调按 Session 绑定。子 Agent 会继承它，因此子 Agent 也能重命名它所属 Project 内的 Session。`rename_session` 工具接收必填的 `title`（1–120 字符）和可选的 `session_id`；不带 `session_id` 时重命名工具所在的 Session。缺失或空的标题会让调用失败；宿主拒绝的重命名（目标不存在，或属于另一个 Project）则记在结果里，不让调用失败。`rename_session` 进入了默认内置工具列表，新建的 Agent 会自带它；已有 Agent 通过下文所述的 kernel 更新获得它。
- **Server** 在会话运行时实现这个 `SessionControl` 回调：解析目标（`session_id` 或宿主所在的 Session），要求目标与工具所在的 Session 属于同一 Project，用 HTTP 端点同一套规则校验标题（去掉首尾空白后 1–120 字符），在 Session 索引里更新标题，并用既有的 `session_title` 事件通知 Project 的其他用户——重命名在 Web App 里的呈现，和从 Web App 重命名时完全一样。
- **CLI**：`penguin session` 组以 `rename <title> [session_id]` 开始。显式给出的 session id（完整 id 或唯一片段）总是优先；省略时，如果命令在某个 Session 内运行，目标就是调用它的 Session（`PENGUIN_SESSION_ID`），否则才取 Agent 最近的一个 Session，并在 stderr 上用一行暗色的 `[latest]` 标出。最近的 Session 可能是另一个并行的会话，所以它只是兜底，不是“重命名当前对话”的默认值。`--json` 打印 `{sessionId, title}`。`penguin run --title <title>` 在 Task 开始前把标题应用到 Session，新建和 `--session` 复用两条路径都生效，`--background` 运行也会被命名。两个命令都在发出请求前校验标题（去掉首尾空白后 1–120 字符），坏标题不会留下一个没命名的 Session。
- **Web App**：工具卡片把 `rename_session` 显示为 **重命名** / **Rename**，与其他内置工具的别名并排。
- **Kernel**：新增默认工具会改变工具页，所以 `KERNEL_VERSION` 改为 `2026-10-09` 并写入新的工具页哈希，旧哈希记为已被取代。工具页仍与某个旧默认值一致的 Agent 会在下一次 kernel 更新时获得 `rename_session`；改过工具列表的 Agent 保持原样。
- **文档**：CLI 参考新增了 `penguin session` 一节和 `penguin run` 下的 `--title` 一行。工具页的内置工具数量改为 8，表格里加了一行 `rename_session`。
