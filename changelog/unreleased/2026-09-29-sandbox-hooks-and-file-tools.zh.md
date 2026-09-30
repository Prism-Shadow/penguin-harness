# 沙盒约束钩子脚本、stdio MCP Server 与文件工具，scratchpad 可写

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#893](https://github.com/Prism-Shadow/penguin-harness/pull/893)
- **Breaking:** yes — 封禁模式下，文件工具与钩子脚本和命令一样受约束，不能写记忆与 Agent State；`scriptStopHook` / `scriptPreToolUseHook` / `scriptUserPromptHook` 改为接受选项对象

[English](2026-09-29-sandbox-hooks-and-file-tools.md)

Session 的沙盒策略原先只约束 Agent 执行的命令，此次扩展到 Session 运行的钩子脚本、它以 `stdio` 方式启动的 MCP Server，以及文件工具 `read_file`、`edit_file` 与 `write_file`。`workspace-write` 下，Session 的 scratchpad（`<agent>/scratchpad/<session_id>`，计划文件、goal 的状态文件与附件都在这里）与 Workspace、临时目录一同可写，对三者同口径。

## 细节

- **一份策略，一条缝。** 策略仍是 Session 索引行上的 `SandboxSettings` 快照（模式、网络、屏蔽路径、临时目录可写），子会话沿用；它只经 `confineSpawn` 抵达 core，这条缝现在包裹 core 为 Session 拉起的一切：命令子进程、钩子脚本、`stdio` MCP Server 与文件工具的助手。confiner 对助手 argv 的回答同时决定该 Session 是否处于封禁：原样返回 argv（契约中「不封禁」的表达）即让文件工具留在进程内。
- **钩子脚本。** `runHookScript` 新增 `confine?: (argv) => ConfinedSpawn`，拉起它返回的 argv，并把运行器所需的环境项叠加在脚本的环境上。`scriptStopHook`、`scriptPreToolUseHook` 与 `scriptUserPromptHook` 改为接受选项对象 `ScriptHookOptions`：`timeoutS`、`pathPrepend`、每次运行都重读的 `confineSpawn` getter，以及 `scope: { workspaceDir, scratchpadDir }`，user-prompt 适配器另有 `trigger`。`Agent.sessionHooks` 把 Session 的 `confineSpawn` 与范围绑定到每条已安装的命令上，因此脚本以 `node <script>`、包目录为 cwd 的形式受封禁。`confineSpawn` 抛错时该次钩子失败，错误为 `sandbox: …`，与其他钩子失败一样记为 `hook failed: sandbox: …`；脚本不会运行。
- **stdio MCP Server。** `McpToolProviderOptions` 新增 `confineSpawn` 与 `scratchpadDir`，由 Environment 从自己的配置传入；`stdio` Server 的 `[command, ...args]` 在构建 transport 之前先经 confiner 改写，`cwd` 为该 Server 的工作目录、范围为 Session 的 Workspace 与 scratchpad，运行器要求的环境项叠加在 Server 自己的环境之上。confiner 抛错即该 Server 连接失败（`error_message` 带 `sandbox: …`），与其它连接失败同样上报，Server 不会启动。经 `http` / `sse` 访问的 Server 不是本机进程，不受影响。
- **文件工具。** `read_file`、`edit_file` 与 `write_file` 的每一次文件系统效果——stat、读取（含分块的文本窗口扫描）、原子写入、列目录、`realpath`、`readlink`、`mkdir`，以及 `read_file` 下载图片 URL——都改经一个端口执行（`environment/tools/fs-port.ts` 的 `FsPort`），以 `ToolExecutionContext.fs` 交给工具，首次使用时才解析，不碰文件的调用不会向 confiner 询问；`fs.sandboxed` 说明它是哪一个端口。未封禁的 Session 用本进程（`localFsPort`）；封禁的 Session 用一个助手进程（`environment/tools/fs-worker.ts`）：以 `node -e <程序>` 启动的 Node 进程——程序内联传入、只用内置模块，无需随 bundle 分发任何文件——其 argv 经 confiner 改写、范围为 Session 的 Workspace 与 scratchpad，以 stdin / stdout 上的 JSON 行提供各原语，二进制走 base64。每个 Session 一个助手（`SandboxedFsHost`）：在第一次受封禁的文件操作时启动、此后复用，confiner 的回答变化或崩溃后重新启动，调用被中止时被杀掉（沙箱可能正卡住该操作），随 `Environment.dispose` 结束。错误的 `code` 原样跨越边界，工具的诊断不变；封禁 Session 下的权限错误（`EROFS` / `EACCES` / `EPERM`）报告为被沙箱拒绝。在为 Windows 宿主服务的 Linux 发行版内（WSL），盘符路径进入时映射为 `/mnt/<盘符>`，返回时还原。
- **scratchpad 交给后端。** `SpawnConfiner` 的选项新增 `scratchpadDir`，服务端的 `confinerFor` 把它放进插件契约新增的可选字段 `SandboxPolicy.writableRoots`。`workspace-write` 下，bwrap 与 Seatbelt 把它加入可写根，WSL 在发行版能访问它时按转换后的路径把它绑定进发行版。不实现该字段的后端只会约束得更窄，不会更宽，因此没有为它设隔离维度。
- **文档与 Skill。** 设置（沙盒）、工具与审批（文件工具）、Agent 运行循环（钩子）、技能与插件（钩子包）、核心接口以及 Server 启动与子系统各页描述了三类执行者、可写目录与新的接缝。`agent-initialization` Skill 写明钩子在 Session 的沙盒下运行，它的钩子参考列出了 `sandbox:` 失败。

## 未覆盖

- 记忆与 Agent State（`AGENTS.md`、`system_config.yaml`、vault、Skill、钩子包、定时任务）仍在两种封禁模式的可写目录之外。封禁中的 Agent 写不了记忆，不能自行编写 Skill 或钩子包，也改不了自己的配置，因此同样加不进 MCP Server；这些都需要完全访问。
- 注入的 `penguin` CLI 经服务端 API 所做的改动（定时任务、插件安装）走网络而非文件系统，只受网络档位约束：无网络档位下该路径随之关闭。
- DSH 适配器只把模式与 Workspace 交给 DSH，因此在 DSH 下，命令与钩子脚本写不了 scratchpad。
- WSL 发行版的默认软件包列表新增 `nodejs`，用来运行钩子脚本与文件工具的助手；隔离检查会报告它是否存在。此前初始化的发行版需要重新初始化——在那之前，钩子与文件操作在其下会失败，而不会脱离封禁运行。

## 兼容性

- 策略为封禁模式的 Session，其文件工具与钩子脚本从下一次调用起受约束，已打开的对话也不例外；其 `stdio` MCP Server 从下一次启动（上下文开启或重连）起受约束，必须写可写目录之外、或需要网络档位所切断的网络的 Server 在那里不再能连接。写记忆、Skill、钩子包与 Agent 配置会被拒绝；需要这些的对话，用它的**权限**按钮切到完全访问。沙盒关闭的 Session 不受影响。
- DSH 下，写 scratchpad 的钩子（包括目标模式的钩子）会失败；WSL 下，没有 `nodejs` 就初始化的发行版会让每个钩子与文件操作失败，直到重新初始化；`stdio` Server 只有命令在发行版里存在时才能运行。需要在这些后端上使用它们的对话，改用完全访问运行。
- SDK：不存在 `EnvironmentConfig.sandboxPolicy` 与 `CreateAgentOptions.sandboxPolicy`，`confineSpawn` 是唯一的缝。`scriptStopHook`、`scriptPreToolUseHook` 与 `scriptUserPromptHook` 原先的 `timeoutS` 与 `pathPrepend` 参数，改为以第四个参数 `{ timeoutS, pathPrepend }` 传入。
