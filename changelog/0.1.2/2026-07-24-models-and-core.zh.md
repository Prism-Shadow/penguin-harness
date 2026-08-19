# 模型与 core：文件工具、运行中转向、/model 切换，以及新的 OpenRouter 模型

- **Date:** 2026-07-24
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#56](https://github.com/Prism-Shadow/penguin-harness/pull/56), [#60](https://github.com/Prism-Shadow/penguin-harness/pull/60), [#61](https://github.com/Prism-Shadow/penguin-harness/pull/61), [#62](https://github.com/Prism-Shadow/penguin-harness/pull/62), [#63](https://github.com/Prism-Shadow/penguin-harness/pull/63), [#64](https://github.com/Prism-Shadow/penguin-harness/pull/64)

[English](2026-07-24-models-and-core.md)

## 文件工具：read_file、edit_file、write_file

内置工具集新增三个文件工具。`read_file` 返回 `cat -n` 风格的带行号视图，支持 `offset`/`limit` 分页（默认 2000 行），并且是增量读取而不是整file吞入：一次可中止的扫描，带 8MB 硬上限，只保留请求的窗口，检测 CRLF，并截断过长的单行。它的输出上限为 64000 字符，而其他内置工具是 16000；输出自带预算控制，因此末尾那句「文件共 N 行；显示 X–Y」的续接说明总能在截断中幸存。它拒绝二进制内容并指向 shell 与图像工具，也按 basename 拒绝 `.vault.toml` / `.project_config.toml`——它在只读审批下是自动批准的，因此这些密钥文件需要自己的守卫。`edit_file` 执行精确的 `old_string` → `new_string` 替换：该字符串必须恰好出现一次——零次与多次都会带解释地失败——`replace_all` 用于批量修改；成功时回以一行摘要加一份 git 风格的统一 diff：每个替换点一个 hunk、邻近位置合并，在 `replace_all` 风暴下至多 5 个 hunk 并附「……另有 N 处替换」的说明，同样自带预算控制，使摘要与说明在截断中幸存。`write_file` 写入整个文件，按需创建父目录，并报告它是新建还是覆盖——覆盖时追加一份针对原内容的真实行 diff（diff 超过约 60 行后退化为 `+X/−Y` 的一行式），新建则不带 diff——CLI 会为这两个工具 diff 输出中的 `+`/`-`/`@@` 行着色。两个写入工具都是原子落盘（先在目标目录下写临时文件，再 rename，并保留既有权限位），两个界面中的审批提示都会展示解码后的编辑或写入载荷，因此用户批准的是真正的改动。三者都把相对路径解析到 Workspace 之下，并在与 shell 工具相同的信任模型下接受绝对路径，而 shell 工具仍是其余一切的通用兜底。文档站的立论也随之重写——它此前把「完全没有文件工具」作为一条设计信条——现在围绕九个内置工具的集合展开（中英）；落地页博客的早期文章保留其历史上的六工具描述。新建 Agent 会获得文件工具；已有 Agent 被冻结的工具列表则不会，除非其配置被恢复为当前默认值——见[向后兼容](2026-07-24-backward-compatibility.zh.md)。

## 模型撰写的调用描述

四个命令/子 Agent 工具——`exec_command`、`input_command`、`run_subagent`、`input_subagent`——接受一个可选的 `description` 参数：一句由模型撰写、使用用户语言的话，说明这次调用在做什么，在运行期间显示于各界面。该参数像其他工具参数一样存在于 `system_config.yaml` 中这四个条目的 schema 里；只要该条目的 `call_description` 开关（缺失即为启用）处于开启状态，它在那里就是必填的，因此一个提供描述的工具总会携带描述，前端也就能预先确定某次调用的展示形态，而不必在流式过程中猜测；关闭该开关会把该属性及其 `required` 项从组装出的 schema 中过滤掉，且从不重写已存的 YAML。Web 端的 Tools 标签页可逐行切换它。文件工具不接受 `description`：它们的路径参数本身就是自解释的。每个 schema 都把对用户最可见的参数排在最前——这四个工具是 `description` 在前，文件工具是 `file_path` 在前——因此它会最先流入 CLI 与 Web 的预览。

## 精确的 CLI 调用与输出格式

CLI 中的工具调用渲染为 `name <- description (payload)`，而对于 schema 不提供描述的工具则是朴素的 `name <- payload`——该形态是依据本次会话组装出的工具列表预先确定的，而不是在参数流入时猜测，因此朴素形式可实时流式输出，而带描述的调用会等待它那句话、并且只会以带描述的形式出现。调用行与输出行共用完全一致的 `[tool-NNN] name` 前缀，因此 `[tool-NNN] exec_command <- $ date` 与 `[tool-NNN] exec_command -> output` 成对；如果某个输出对应的调用从未被看到，则保留裸的 `[tool-NNN] ->` 标记。文件工具的预览把路径缩短为一层父目录加文件名；聊天与运行的启动横幅现在把版本以及 Agent、Workspace、Model 各自单独成行地打印出来。

## 转向：向运行中的任务发消息

运行中的任务此前是够不着的——运行途中发送的任何内容都只能等到下一次空闲。现在 `Session.steer` 与 `POST /api/sessions/:sessionId/steer` 能把一条消息投递进 RUNNING 状态的任务：文本先入队，在下一次输入组装时作为一条独立的用户消息交付，用成对的 `[user_steering]` 标记包裹，与该轮的工具输出一并发送——作为真实的用户输入写入 Trace，在同一位置流式呈现，且绝不会在界面上把 Task 切开。工具输出永不被改写，而转向的权威性来自该消息的用户角色——某个工具在自己的输出里打印这个标记并不能冒充用户。队列在每次输入组装时排空，包括压缩刚结束之后（在漫长的摘要请求期间到达的转向消息会紧跟摘要之后被投递），只有在运行退出时才被丢弃；若某一轮结束时队列仍非空，循环会带着队列中的文本经同一机制继续。该标记记录在默认提示词的「系统标记」小节中。

繁忙的会话也可以容纳普通的后续消息：`POST /api/sessions/:sessionId/tasks` 接受 `queueIfBusy`，返回 202 并在服务端排队；当运行结束时——包括被中止——每条排队输入都会按顺序作为普通任务自动启动，并携带与之一同存储的逐轮思考等级，而不是回退到会话默认值；排队数量会随任务状态事件与会话快照一并下发。在 CLI 中，任务运行期间输入的一行会成为转向消息（确认信息会回显该文本），渲染器在用户正在输入时会暂存流式输出，并在提交时刷出；而输给完成竞态的转向消息会作为下一条普通提示重新提交。

## 系统标记改为成对方括号

每一个系统合成的标记都从尖括号形式切换为成对的方括号形式：`[turn_aborted]`、`[turn_retried]`、`[context_summary]`、`[summary]`、`[use_skills]`、`[handoff_from]`、`[scheduled_task]`、`[developer_instructions]`，以及合成块内部的对话记录标签。产出方只发出新形式，而解析器继续读取旧的尖括号形式——见[向后兼容](2026-07-24-backward-compatibility.zh.md)。每个标记的产出方与解析器都移入了 core 的同一个模块 `omnimessage/markers/`，同时可经 `@prismshadow/penguin-core/markers` 子路径访问，使标签字面量与双形式读取规则有了单一归属，而不再散落在 core、server 与前端之间。文档中的标记字面量已相应更新（中英）。

## 思考等级改为逐请求；session_meta 只保留不变量

`thinking_level` 从 `session_meta` 中移除：该 meta 现在只保存逐会话的不变量，凡是用户在对话中途可以改变的，要么是逐轮参数，要么就是一个新会话。等级改为以逐请求参数的形式贯穿——`GenerativeModelParameters`、`RunOptions` 与 `TaskCreateRequest`——构造时的取值仅作为默认值；压缩请求刻意保持使用默认值。记录了该字段的 Trace 在恢复时仍被尊重——见[向后兼容](2026-07-24-backward-compatibility.zh.md)。

## 切换模型：一个会读取源 trace 的新会话

在另一个模型上继续对话时，不会向新会话注入任何历史：思考载荷与 Provider 保真信息是与模型绑定的，无法跨模型忠实回放，因此早先那种携带历史的 fork 设计被放弃，改用交接模式。Web 端的 `/model` 命令会经普通的会话创建 API，为同一个 Agent 在所选模型上打开一个**新**会话——刻意复用源会话的 Workspace，使对话所引用的文件仍然可达，同时也复用其审批模式——并投递第一个任务，其输入以成对的 `[model_switch_from]` 源信息块开头，包含源会话 id、其最新 trace 文件的绝对路径、工作区，以及此前的模型二元组，遵循方括号标记约定。模型在需要更早的上下文时会自行读取源 trace。`SessionInfo` 新增可选的 `tracePath`（最新分片，仅在单会话 GET 中填充），并且该标记会从生成的标题中剥离。

## 提示词把项目目录呈现为 App Data Dir；恢复默认是采用路径

模型总把 Environment 小节里的 `Project Dir` 误认为用户的工作目录（那其实是 `CWD`）——把它的内容当作任务输入，并把任务产物写进去。默认提示词现在用一个能说明其本质的名字来呈现同一个值：Environment 行写作 App Data Dir（`{{PROJECT_DIR}}` 占位符未变，因此已有的自定义提示词不受影响），而「文件系统」小节明确陈述其语义——PenguinHarness 的应用数据根目录，存放每个 Agent 的数据文件以及项目级数据文件；它不是当前任务的目录，不是用户提供的输入，也绝不是放置任务产物的地方（工作文件夹是 `CWD`）。提示词中的路径（Agent State、其他 Agent 的资产、草稿区、Skill）写作 `<app_data_dir>/agents/…`，而密钥规则直接指向 App Data Dir 下的 `.project_config.toml`。六个内置 Skill 从 Environment 小节读取 App Data Dir 字段——评估家族对项目根目录的推导简化为 App Data Dir 本身——Web 端系统提示词编辑器的占位符提示也以应用数据根目录的描述来说明 `{{PROJECT_DIR}}`，按提示词中的顺序完整列出。

默认值的变化绝不会自行到达已有 Agent，因为已存配置是逐字加载的。采用路径是一个新的「恢复默认配置」操作——`POST /api/projects/:projectId/agents/:agentId/config/reset` 以及 Agent 设置 Overview 标签页上对应的操作，置于确认对话框之后——它是 Skill 更新在配置侧的对应物；它保留什么、覆盖什么，在[向后兼容](2026-07-24-backward-compatibility.zh.md)中有详细说明。

## OpenRouter 新增：三个免费模型与 Claude Opus 5

目录新增三个 $0 的 OpenRouter 行：`inclusionai/ling-3.0-flash:free` 与 `poolside/laguna-m.1:free`——Ling 3.0 Flash（一个 124B 参数的 MoE）与 Laguna M.1 的免费档，二者上下文均为 262,144——以及 `openrouter/free`，即把每次请求随机发往某个免费模型的免费模型路由器。该路由器刻意声明不支持视觉，因为 Harness 不得把图像发给一个目标可能是纯文本的路由器；它还记录了一个保守的 128,000 Token 上下文下限，使 75% 的压缩夹紧线落在 96,000 Token：若不记录窗口，该夹紧会被静默禁用，而一个被路由到小窗口目标的长会话就会直接硬失败，而不是提早压缩。目录测试中的免费定价不变式恰好覆盖 `:free` 后缀与该路由器 id，Web 界面把这类行标为 Free，模型文档（中英）也说明了免费变体、其零成本，以及 OpenRouter 的免费档限流与数据政策。

与免费阵容一同被要求加入的 `anthropic/claude-opus-5` 作为付费旗舰进入 OpenRouter 区块：上下文 1,000,000，支持视觉，每百万 Token 输入 $5 / 输出 $25，并采用真实公布的缓存价格（读取 $0.50、写入 $6.25），而不是沿用「重复输入」的惯例——按同系列最新在前的规则，紧排在 `claude-fable-5` 之后。
