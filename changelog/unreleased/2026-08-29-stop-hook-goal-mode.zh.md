# Hook 进核心，目标模式与持续学习成插件，技能库改为插件库

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `core`, `plugins`, `server`, `web`, `cli`, `desktop`, `docs`
- **Breaking:** yes

[English](2026-08-29-stop-hook-goal-mode.md)

Session 新增了通用的 hook 机制：核心只编码钩子*点*——**stop**（一个 Task 结束的那一刻）、**pre_tool_use** 与 **user_prompt**——钩子本身来自插件的**钩子包**：装进 `agent_state/hooks/`（与 `agent_state/skills/` 并列）的纯 Node 脚本。目标模式整个搬出核心，成为 `goal` 插件的 stop hook，ralph loop 式：一份状态文件，钩子在每个 Task 结束后读它、重写它。第二个钩子包 `continual-learning` 把长任务的发现交给后台子会话。技能库重整为插件库——每个插件一个 npm 包（`@penguinharness/<name>`）、Skill 与钩子包放在其中、版本按日期编号，由 `@prismshadow/penguin-core` 加载——`@prismshadow/penguin-skills` 弃用。

## Stop hook

- 一次 `run` 调用的每个 Task 结束后，Session 咨询 Agent 已安装的钩子包（仅顶层 Session），把各自的 `stop` 命令作为子进程运行，stdin 只给 `{ hook, session_id, trace_path }`。token 用量、轮次、Task 的结束方式、状态文件都由脚本从 Trace 推导。`subagent` 请求派生的游离子会话：其 session id 记在 hook 事件上，子会话的 `session_meta` 紧随该事件回吐到流上，服务端据此登记它（有会话记录、列于子会话分组，不进父会话的嵌套视图），而不是留下一个无处打开的 id。被掐断之后 `continue` 不续跑——`max_turns` 上限现在也算掐断（`RunCutoff.kind: "max_turns"`，引擎此前对此返回 null），任何 hook 都不能重启被上限关掉的 Task；子会话轮次撞上上限时按失败上报并带该原因，而不是把上限提示当作答复交回。
- 脚本回答 `continue`（附下一个 Task 的 user 文本 `input`）、`stop`、`subagent` 请求（`{ prompt, agent_id? }`——Session 派生一个游离的后台子会话，继承本次运行的审批回调，记下其 Session id），或什么都不答。每个非空回答成为一条通用的 `hook` 事件消息——`hook`、`name`（钩子包名）、`decision`、`reason`、标量 `output`——推到流上并写入 Trace；注入的输入是紧随其后的那条 user 消息，带 `sender: "harness"` 标记——宿主渲染与判定来源全凭这一结构化标记，没有任何文本协议。第一个 `continue` 在同一次 `run` 内驱动下一个 Task；被掐断或 signal 已中止时，`continue` 只记录、不执行。崩溃、打印非 JSON 或超时（缺省 60 秒）的脚本只记录、按无意见处理。
- 第三个钩子点 **`user_prompt`**：扩展提交的 Prompt。钩子只在 core 里运行：宿主在接受它所属流程的用户 Prompt 时经 `Session.runUserPromptHook` 触发，回答的 `context` 带 harness 标记紧随用户消息发出。目标模式的启动即内置用途——goal 插件的 `start.mjs` 就是它的 `user_prompt` 命令。
- 第二个钩子点 **`pre_tool_use`**：每个工具调用审批之前运行（`hooks.json` 的 `pre_tool_use` 命令；stdin 额外带 `tool_name`、`tool_call_id` 与原始 `arguments` JSON）——`deny` 不咨询审批直接拒绝，模型在工具输出里读到钩子名与理由；`allow` 免审放行，但命令策略仍压过它（钩子包在 Agent 可写的状态里）；没有内置插件使用此点，留给自定义守卫。
- SDK 嵌入方仍可注册进程内 hook（`SessionConfig.hooks.stop` / `.preToolUse`）；子进程运行器（`runHookScript`）导出给要调用钩子包其它脚本的宿主。
- Trace 页渲染 `hook` 事件；CLI 为每个非 goal 的 hook 回答打印一行暗色文字。

## 作为 `goal` 插件的目标模式

- 核心不再知道目标是什么——`session.run` 的 `goal` 选项、目标文件辅助函数、`goalOutcomeOf` 连同 `[goal]` 标记本身（`goal-block` 标记模块）全部移除。轮消息就是纯文本 user 消息：没有协议块，来源只由 `sender: "harness"` 标记承载。插件（`default_agent` 预装）带 `start.mjs`（写下 `GOAL.json`——`objective`、`status`、`budget`、`round`、`tokens_used`，钩子对终态动过手后再加 `ended`——并组装第一轮的协议消息）与 `stop.mjs`（每个 Task 结束后从 Trace 读本轮用量——窗口自本轮注入输入起算，完成回报虽共用标记但不是边界——沿用原判定顺序——模型裁决 → 掐断 → 收尾轮 → 100 轮兜底 → 预算 → 下一轮——并重写文件）。
- 服务端对 `goal: { budget }` 先查钩子包是否已装（未装 `409 goal_plugin_not_installed`），运行 `agent_state/hooks/goal/start.mjs`，把你的消息原样在前（文本与图片，一字不动）、它打印的协议消息带 harness 标记随后提交；后续轮从目标文件复述目标文本。`GET /goal` 读 `GOAL.json`（Session 空闲时仍为进行中的状态读作 `aborted`；响应不再带 `updatedAt`）。插件的启动 hook 在会话锁内、空闲检查之后运行，正在运行的 goal 之上再提交一个 goal 会在改写目标文件之前被拒绝。`goal_*` 服务端事件、聊天页 banner、`/goal` 命令与 `penguin run --goal` 行为不变——`goal_round` 与 CLI 的轮次行改为统计 harness 注入的输入而非解析文本；CLI 从 `goal_finished` 服务端事件读结局。文件附件被拒绝。顺带修复：`startGoal` 此前不把种入的第 1 轮消息发布到会话频道（core 从不回吐运行自己的初始输入），同一会话的第二个 goal 在已订阅页面上既看不到用户消息也看不到协议消息——任务边界与统计行随之缺失——直到刷新；`goal_round` 的第 1 轮现在真正发出（计自种入输入）。
- 在没装插件的 Agent 上发起目标时，Web App 弹出提示。轮消息渲染为一张紧凑的折叠卡片（「由 harness 注入」，后台任务通知同款形态，展开见全文）——「目标 · 第 N 轮」的折叠不复存在；输入历史与对话索引凭标记跳过 harness 注入的输入（后台完成回报保留自己的轮次）。

## `continual-learning` 插件

- 不预装。刚结束的 Task 跑了超过 30 个完成的轮次时，它的 stop 脚本把该 Task 浓缩（截断的 user / assistant 文本、工具调用与输出），以 `subagent` 请求作答，prompt 请子会话把值得沉淀的发现写进相关 `SKILL.md` 并递增版本。窗口就是 Task 本身，因此一个任务至多在结束时触发一次，短任务从不触发。没有安装任何 Skill 的 Agent 不会触发。

## 插件库

- **每个插件都是独立的 npm 包**：`@penguinharness/<name>`，仓库根目录 `plugins/` 下一包一插件（`plugin.json` + `icon.svg` + `skills/<name>/` + `hooks/`）；loader 并入 `@prismshadow/penguin-core`（取代 `packages/skills` 包）——从宿主包的依赖清单读出插件名，再从自身所在位置经 Node 逐包解析：工作区、npm 安装与 desktop 应用各自落在自己的副本上（desktop 应用把各插件包声明为依赖，electron-builder 打包时收进应用，打包产物检查会逐个核对）。四组合并为多 Skill 插件：`software-development`（software-engineering＋web-design）、`model-development`（llamafactory＋ollama＋vllm）、`agent-development`（penguin-sdk＋`unified-llm-api`〔原 agenthub-models〕＋`penguin-config`〔原 penguin-cli〕＋penguin-orchestration）、`agent-tuning`（initialization＋benchmark-design＋evaluation＋optimization）；其余仍各自成包，预装口径不变；围绕他人产品构建的插件带 `use-` 前缀——`use-firecrawl`、`use-bento-slides`、`use-claude-code`——包名说明用途而不冒用产品名（其中的 Skill 名不变）。三个分类：办公效率（两个钩子包也在这里——目标模式与持续学习服务的正是这群用户）、软件开发、AI 应用开发（含 `agent-tuning`；Agent 调优与会话钩子两个分类退场）。版本一律 `YYYY-MM-DD.N`，`plugin.json` 是插件唯一的元数据载体——库内 `SKILL.md` 的 frontmatter 只写 `name` 与 `description`，短描述与版本由 loader 盖章进可安装副本（已装 frontmatter 保持自描述，供更新检查与 UI 读取）。**图标属于插件**——`plugin.json` 同级的 `icon.svg`，每个内置插件都有——插件携带的一切都继承它：loader 把它盖章到每个 Skill 上，安装时写在 Skill 的 `SKILL.md` 旁与钩子包的 `hooks.json` 旁，设置页的技能与钩子标签页、输入区的技能选择器与对话里的技能标签显示的都是它。没有图标的一律回退该类事物的统一图形——Skill 是书本，钩子包是钩子，插件是拼图块——导航栏里插件库的标记也改为这枚拼图块（书本仍是 Skill 的标记）。自然数 `version` 与 `updated` 时间戳退场。
- Agent State：`agent_state/hooks/<plugin>/` 存放钩子包（由清单生成的 `hooks.json`——`name`、`description`、`description_zh`、`version` 与每个钩子点各一份命令清单——加脚本），与 `agent_state/skills/` 并列；状态层新增 `installPlugin`、`installHook`、`removeHook`、`listInstalledHooks`。`default_agent` 预装全部未标 `preinstall: false` 的插件。经 API 安装或卸载钩子包会使该 Agent 已缓存的运行时失效（钩子在 Session 构建时绑定）。loader 在声明的插件包缺失或 `plugin.json` 损坏时拒绝加载（那是安装坏了，而不是库变小了）。
- API：`GET /api/plugins`（分类 → 插件，含各自 Skill 元数据与钩子点）、`GET /api/plugins/:plugin/files`（插件携带的全部文件，按路径键入的文本：各 Skill 的可安装 `SKILL.md` 与参考文件、钩子脚本）、`POST …/agents/:a/plugins { names }`（整插件安装；重装即更新）、`GET|DELETE …/agents/:a/hooks[/:name]`（`HookItem` 带插件的 `icon`；`PluginItem` 不带 `preinstall`）。`GET /api/skills` 与 `POST …/skills { names }` 移除；已装 Skill 的路由（列表、zip 导入导出、卸载）保留。Agent 创建改收 `plugins` 而非 `skills`；`AgentSummary` 报告 `hookCount` 与 `pluginUpdates`（原 `skillUpdates`）；`SkillMetadataItem.version` 改为字符串、`updated` 移除。
- Web App：技能库页改为**插件库**（`/plugins`）——每张卡片带一行语义化元信息（`v<版本> · N 天前更新 · N 个 Agent 在用`，日期直接解析自版本号），点开即详情 Modal：完整描述与钩子点，其下是插件全部文件的浏览器，形态同 Benchmark 的 Case 浏览器——左侧文件树按 Skill 分组、钩子脚本单独一组，可同时展开任意多组，右侧预览所选文件，打开文件不会覆盖摘要与文件树；按整插件安装与更新；Agent 设置页新增**钩子**标签页；创建弹窗按插件选装。CLI：`penguin agent create --plugins`。
- 设计规格已同步改写（[penguin-harness-design #86](https://github.com/Prism-Shadow/penguin-harness-design/pull/86)）。

## 兼容性

- **`@prismshadow/penguin-skills` 弃用**，该名下不再发布新版本；发布链改发 `@penguinharness/*` 各插件包（由 `@prismshadow/penguin-core` 加载）。
- **既有已装 Skill 带的是自然数版本**，会读作空版本，因此插件库会把它们各报一次可更新；从库重装即带上日期版本。
- **既有 Agent 没有任何钩子包**——不会向已存在的 Agent 自动安装。这样的 Agent 上发起目标会收到 `409 goal_plugin_not_installed`，直到从插件库装上 `goal` 插件；此后新建的 `default_agent` 自带。
- **`goal_finished` 与 `goal` 运行选项不复存在**（连同上一轮迭代的 `goal_state` 表一起移除）；`goal_*` 服务端事件不变。早期版本的 Trace 仍带 `goal_finished` 记录，读取方把它当作未知事件。
- **`[goal]` 标记不复存在**——`parseGoalMessage`、`isGoalRoundInput`、`downgradeGoalInput` 与 `GoalRoundMessage` 不再导出，`MARKER_TAGS` 也不再有 `goal` 标签。旧 Trace 中带 `[goal]` 块的轮消息按纯文本渲染（块原样可见、没有轮次小注），照常开对话索引条目、照常进输入历史；新的轮消息改带 `sender: "harness"` 标记。
- **`system_config.yaml` 的 `hooks.skill_summary`** 不再读取：装上 `continual-learning` 插件就是开关。
- **此前安装的 Skill 与钩子包没有图标**（当时没有任何东西把图标写在它们旁边），其行显示书本或钩子图形，直到从库重装或更新该插件——那会把插件图标写到位。
- Agent 创建的 `skills: string[]` 字段与 CLI 的 `--skills` 改为 `plugins` / `--plugins`。
