# 设置 › 存储空间：显示数据根的占用，清理可以再生的文件

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `plugins`, `server`, `web`, `cli`, `ui`
- **PR:** [#1641](https://github.com/Prism-Shadow/penguin-harness/pull/1641)

[English](2026-11-19-storage-settings.md)

设置在「已归档对话」之后新增**存储空间**子页，shell 新增 `penguin storage`，两者都来自新的预装插件 `storage`（`plugins/storage`）。页面按八个分类显示数据根的占用，并按 Project 与 Agent 分项；经审阅后清理可以安全删除的草稿区、临时工作区与缓存；按大小与时间列出会话，以删除其轨迹。成员看到并清理自己可进入的 Project，管理员另可看到并清理整个数据根。

## 细节

- **预装插件**：`@penguinharness/storage` 带一个服务端模块（`StorageModule`，`.`）、一个 Web 半部（`./web`，经 `SettingsModule.sections` 提供设置子页，模块运行时才绘制）和一个 CLI 半部（`./cli`）。卡片写明 `preinstall: true`，因此每个新 Project 都列入该模块，已有的 Project 列入一次（见[向后兼容文件](2026-11-20-backward-compatibility.zh.md)）。它的 Skill `storage` 让 Agent 运行 `penguin storage`，告诉用户空间被什么占用、哪些可以删除；它自己从不删除，删除也会拒绝 Agent 的令牌。接口数据类型是插件自己的 `./types` 入口。
- **通用的服务端接口**：插件只经插件门面使用宿主，门面为此新增三个不含存储字样的接口，并导出几个已有的——
  - `DataLayout`：数据根的各个文件夹，来自定义布局的路径函数。插件遍历的每条路径都取自它，规划中的 `projects/` 层级无须改动插件。
  - `SessionActivity`：会话运行时回答某个会话或某个 Agent 的会话是否在使用。
  - `DeletingFolders`：以一次同步 rename 把文件夹移入其 Project 的 `agents/.deleting/`（不属于任何 Project 的，移入旁边的 `.deleting/`），再经服务端限流在后台删除。
  - 已有的接口以类型导出：`Access`、`Projects`、`ProjectConfigStore`、`TraceIndex`、`TraceIndexStore`、`AgentConfig` 与 `FileReveal`；以值导出 `FsLimiter`、`readJson`、`parseNonNegativeInt` 与 `listingViewOfRequest`；core 的 plugin 子路径另导出 `isValidId`。
- **设置对话框**交给插件提供的子页 `openPage`，经对话框的离开确认切换到另一子页；存储空间页的「已归档对话 › 打开」用的就是它。
- **Web 门面**新增 `formatRelativeShort`、`formatRelativeLong` 与 `formatBytes`，按屏幕上的语言输出。

- **测量**：服务端在后台逐个单元测量——每个 Project 的文件夹一个单元，服务端自己的顶层条目一个单元——与后台删除 Agent 共用同一种限流（同时至多两个文件系统调用），不跟随链接。结果带测量时刻、只存在内存中；页面写明测量时刻，测量进行中时轮询，另有「刷新」；进行中的测量被复用，从不重开。
- **分类**：每个字节恰好计入一类——轨迹；Agent State（`agent_state/`、`agent_state.git/`、`snapshots/`）；临时工作区；草稿区；缓存（Agent 的 `shared_env/` 与 `app/cache/`，以及数据根的 `.cache/`）；日志；插件；其他。管理员另见其不能进入的 Project 的合计（不列名称）与数据根的各个顶层条目。缓存文件夹在插件中登记为一张表（`plugins/storage/src/server/layout.ts`），之后新增的缓存文件夹（如 Workbench 的缓存）登记进表，即计入缓存并可清理。
- **清理先审阅、再删除**：审阅只列出此刻可以安全删除的条目——孤立的草稿区（索引与 Trace 都没有该 Session，且一天内没有改动；缺省勾选）、闲置对话的草稿区（会话属于某个列表、未在使用、最近活动早于所选天数，缺省 7 天；缺省不勾选，删除后这些对话里附带的图片不再显示）、孤立的临时工作区（没有任何 Project 的会话以它、其中的文件夹或该 Agent 的目录与 `workspaces/` 为 Workspace，且一天内没有改动；缺省勾选——仍被会话使用的临时工作区从不列出）、Agent 的工具环境与工作台缓存（`shared_env/<名称>/`、`app/cache/<id>/`，该 Agent 的会话都未在使用时列出；缺省不勾选），以及数据根 `.cache/` 的条目（只对管理员）。
- **删除**：每个条目重新判定，并在同一个同步步骤里以一次 rename 移开——Agent 级的移入 `agents/.deleting/`（服务端下次启动时本就会接着删完），服务端缓存移入该缓存自己的 `.deleting/`，两者都经 `DeletingFolders`——之后才开始的 Task 不会写进正在删除的文件夹。「在使用」指：有 Task 或压缩在进行、有排队的输入、有仍在运行的后台进程或子会话，或正在被删除；由会话运行时经 `SessionActivity` 回答。删除需要本人登录：Agent 的 shell 持有的本地 API 令牌以 `human_required` 被拒。
- **轨迹**：用户的 Project 中的会话按大小（Trace 文件加上测量到的草稿区）或最近活动列出，可按 Agent、归档与否与时间筛选，至多 500 条；运行中的会话标出、不能勾选。「清理旧对话」打开同一个列表，预设为 30 天前的已归档会话。删除走已归档对话页现有的批量删除，会话的子会话、草稿区与草稿一并删除。「已归档对话」打开该子页。
- **接口**：插件的路由为 `GET /api/me/storage`、`POST /api/me/storage/refresh`、`GET|POST /api/me/storage/cleanup`、`GET /api/me/storage/sessions` 与 `POST /api/me/storage/reveal`（在桌面应用自己的窗口中显示数据根或 Project 的文件夹；用量应答中的 `reveal` 表示调用者能否这样做）。
- **`penguin storage`**：按分类、Project、Agent（管理员另有服务端条目）打印已用空间，会等正在进行的测量结束。`penguin storage clean` 只列出不删除，标出页面缺省勾选的项；`--all` 选中全部，`--yes` 才删除。
- **配色**：各分类按一个专门挑选的顺序使用主题的图表色板，使相邻分类在每个主题的浅色与深色下都明显可分。日志与插件只测量、不清理。
- **共享 UI**：共享 UI 包新增带图例的堆叠用量条与「先审阅、再删除」列表，各有组件画廊展板；画廊为每个新接口提供模拟数据。
- **文档**：设置、服务端 API、CLI 与技能页介绍该子页、其路由、命令与插件。
