# Hook 进核心，目标模式与技能沉淀成插件，技能库改为插件库

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `core`, `plugins`, `server`, `web`, `cli`, `desktop`, `docs`
- **Breaking:** yes

[English](2026-08-29-stop-hook-goal-mode.md)

Session 新增了通用的 hook 机制：核心只编码钩子*点*——目前一个，**stop**，即一个 Task 结束的那一刻——钩子本身来自插件的**钩子包**：装进 `agent_state/hooks/`（与 `agent_state/skills/` 并列）的纯 Node 脚本。目标模式整个搬出核心，成为 `goal` 插件的 stop hook，ralph loop 式：一份状态文件，钩子在每个 Task 结束后读它、重写它。第二个钩子包 `skill-summary` 把长会话的发现交给后台子会话。技能库重整为插件库——每个插件一份清单、Skill 与钩子包放在其中、版本按日期编号——`@prismshadow/penguin-skills` 弃用，改为 `@prismshadow/penguin-plugins`。

## Stop hook

- 一次 `run` 调用的每个 Task 结束后，Session 咨询 Agent 已安装的钩子包（仅顶层 Session），把各自的 `stop` 命令作为子进程运行，stdin 只给 `{ hook, session_id, trace_path }`。token 用量、轮次、Task 的结束方式、状态文件都由脚本从 Trace 推导。
- 脚本回答 `continue`（附下一个 Task 的 user 文本 `input`）、`stop`、`subagent` 请求（`{ prompt, agent_id? }`——Session 派生一个游离的后台子会话，继承本次运行的审批回调，记下其 Session id），或什么都不答。每个非空回答成为一条通用的 `hook` 事件消息——`hook`、`name`（钩子包名）、`decision`、`reason`、标量 `output`——推到流上并写入 Trace；注入的输入是紧随其后的那条 user 消息，带 `sender: "harness"` 标记——宿主渲染与判定来源全凭这一结构化标记，没有任何文本协议。第一个 `continue` 在同一次 `run` 内驱动下一个 Task；被掐断或 signal 已中止时，`continue` 只记录、不执行。崩溃、打印非 JSON 或超时（缺省 60 秒）的脚本只记录、按无意见处理。
- SDK 嵌入方仍可注册进程内 hook（`SessionConfig.hooks.stop`）；子进程运行器（`runHookScript`）导出给要调用钩子包其它脚本的宿主。
- Trace 页渲染 `hook` 事件；CLI 为每个非 goal 的 hook 回答打印一行暗色文字。

## 作为 `goal` 插件的目标模式

- 核心不再知道目标是什么——`session.run` 的 `goal` 选项、目标文件辅助函数、`goalOutcomeOf` 连同 `[goal]` 标记本身（`goal-block` 标记模块）全部移除。轮消息就是纯文本 user 消息：没有协议块，来源只由 `sender: "harness"` 标记承载。插件（`default_agent` 预装）带 `start.mjs`（写下 `GOAL.json`——`objective`、`status`、`budget`、`round`、`tokens_used`，钩子对终态动过手后再加 `ended`——并组装第一轮的协议消息）与 `stop.mjs`（每个 Task 结束后从 Trace 读本轮用量——窗口自本轮注入输入起算，完成回报虽共用标记但不是边界——沿用原判定顺序——模型裁决 → 掐断 → 收尾轮 → 100 轮兜底 → 预算 → 下一轮——并重写文件）。
- 服务端对 `goal: { budget }` 先查钩子包是否已装（未装 `409 goal_plugin_not_installed`），运行 `agent_state/hooks/goal/start.mjs`，把你的消息原样在前（文本与图片，一字不动）、它打印的协议消息带 harness 标记随后提交；后续轮从目标文件复述目标文本。`GET /goal` 读 `GOAL.json`（钩子尚未结束的文件在 Session 空闲时读作 `aborted`）。`goal_*` 服务端事件、聊天页 banner、`/goal` 命令与 `penguin run --goal` 行为不变——`goal_round` 与 CLI 的轮次行改为统计 harness 注入的输入而非解析文本；CLI 从 `goal_finished` 服务端事件读结局。文件附件被拒绝。
- 在没装插件的 Agent 上发起目标时，Web App 弹出提示。轮消息按普通用户消息渲染，上方一行「由 harness 注入」小注——「目标 · 第 N 轮」的折叠不复存在；输入历史与对话索引凭标记跳过 harness 注入的输入（后台完成回报保留自己的轮次）。
- 被打断的运行滞留在 carry-over 里的 harness 注入，在消费点被替换为一行过期注记（goal 专属的降级就此泛化）；完成回报原样通过——它是报告，不是指令。

## `skill-summary` 插件

- 不预装。它的 stop 脚本从上一条它记下的摘要事件起截取当前 Trace 的窗口，窗口累积 20 个完成的轮次后把它浓缩（截断的 user / assistant 文本、工具调用与输出），以 `subagent` 请求作答，prompt 请子会话把值得沉淀的发现写进相关 `SKILL.md` 并递增版本。没有安装任何 Skill 的 Agent 不会触发。

## 插件库

- `packages/plugins`（npm `@prismshadow/penguin-plugins`）取代 `packages/skills`：`plugins/<plugin>/plugin.json` + `skills/<name>/` + `hooks/`。既有 Skill 各自成为单 Skill 插件；两个钩子包归入新的 **Session Hooks（会话钩子）** 分类。版本一律 `YYYY-MM-DD.N`——插件清单与 SKILL.md frontmatter 皆然；自然数 `version` 与 `updated` 时间戳退场。
- Agent State：`agent_state/hooks/<plugin>/` 存放钩子包（由清单生成的 `hooks.json` 加脚本），与 `agent_state/skills/` 并列；状态层新增 `installPlugin`、`installHook`、`removeHook`、`listInstalledHooks`。`default_agent` 预装全部未标 `preinstall: false` 的插件。
- API：`GET /api/plugins`（分类 → 插件，含各自 Skill 元数据与钩子点）、`POST …/agents/:a/plugins { names }`（整插件安装；重装即更新）、`GET|DELETE …/agents/:a/hooks[/:name]`。`GET /api/skills` 与 `POST …/skills { names }` 移除；已装 Skill 的路由（列表、zip 导入导出、卸载）保留。Agent 创建改收 `plugins` 而非 `skills`；`AgentSummary` 报告 `hookCount` 与 `pluginUpdates`（原 `skillUpdates`）；`SkillMetadataItem.version` 改为字符串、`updated` 移除。
- Web App：技能库页改为**插件库**（`/plugins`）——卡片显示插件的 Skill 与钩子点，按整插件安装与更新；Agent 设置页新增**钩子**标签页；创建弹窗按插件选装。CLI：`penguin agent create --plugins`。
- 设计规格已同步改写（[penguin-harness-design #86](https://github.com/Prism-Shadow/penguin-harness-design/pull/86)）。

## 兼容性

- **`@prismshadow/penguin-skills` 弃用**，该名下不再发布新版本；发布链改发 `@prismshadow/penguin-plugins`。
- **既有已装 Skill 带的是自然数版本**，会读作空版本，因此插件库会把它们各报一次可更新；从库重装即带上日期版本。
- **既有 Agent 没有任何钩子包**——不会向已存在的 Agent 自动安装。这样的 Agent 上发起目标会收到 `409 goal_plugin_not_installed`，直到从插件库装上 `goal` 插件；此后新建的 `default_agent` 自带。
- **`goal_finished` 与 `goal` 运行选项不复存在**（连同上一轮迭代的 `goal_state` 表一起移除）；`goal_*` 服务端事件不变。早期版本的 Trace 仍带 `goal_finished` 记录，读取方把它当作未知事件。
- **`[goal]` 标记不复存在**——`parseGoalMessage`、`isGoalRoundInput`、`downgradeGoalInput` 与 `GoalRoundMessage` 不再导出。旧 Trace 中带 `[goal]` 块的轮消息按纯文本渲染（块原样可见、没有轮次小注），照常开对话索引条目、照常进输入历史；新的轮消息改带 `sender: "harness"` 标记。
- **`system_config.yaml` 的 `hooks.skill_summary`** 不再读取：装上 `skill-summary` 插件就是开关。
- Agent 创建的 `skills: string[]` 字段与 CLI 的 `--skills` 改为 `plugins` / `--plugins`。
