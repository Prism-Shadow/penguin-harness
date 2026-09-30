# 沙盒约束钩子脚本与文件工具，scratchpad 可写

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)
- **Breaking:** yes — 封禁模式下，文件工具与钩子脚本和命令一样受约束，不能写记忆与 Agent State；`scriptStopHook` / `scriptPreToolUseHook` / `scriptUserPromptHook` 改为接受选项对象

[English](2026-09-29-sandbox-hooks-and-file-tools.md)

Session 的沙盒策略原先只约束 Agent 执行的命令，此次扩展到 Session 运行的钩子脚本，以及文件工具 `read_file`、`edit_file` 与 `write_file`。`workspace-write` 下，Session 的 scratchpad（`<agent>/scratchpad/<session_id>`，计划文件、goal 的状态文件与附件都在这里）与 Workspace、临时目录一同可写，对三者同口径。

## 细节

- **一份策略，两条缝。** 策略仍是 Session 索引行上的 `SandboxSettings` 快照（模式、网络、屏蔽路径、临时目录是否可写），子会话共用。它经 `confineSpawn` 作用于 core 拉起的一切进程，并经新增的 `CreateAgentOptions.sandboxPolicy(ctx)` 交给文件工具：与 `confineSpawn` 同形，按 Session 坐标求值、每次调用重读、由子会话的 Agent 继承，再以 `EnvironmentConfig.sandboxPolicy` 传入。服务端的 `SessionEnv` 新增 `sandboxPolicy(ctx)`，从命令封禁所读的同一份 Session 快照作答（`runtime/session-manager.ts` 中的 `policyOf`），经 `session-service.ts` 与 core 的 Session 加载器转交。
- **钩子脚本。** `runHookScript` 新增 `confine?: (argv) => ConfinedSpawn`，拉起它返回的 argv，并把运行器所需的环境项叠加在脚本的环境上。`scriptStopHook`、`scriptPreToolUseHook` 与 `scriptUserPromptHook` 改为接受选项对象 `ScriptHookOptions`：`timeoutS`、`pathPrepend`、每次运行都重读的 `confineSpawn` getter，以及 `scope: { workspaceDir, scratchpadDir }`，user-prompt 适配器另有 `trigger`。`Agent.sessionHooks` 把 Session 的 `confineSpawn` 与范围绑定到每条已安装的命令上，因此脚本以 `node <script>`、包目录为 cwd 的形式受封禁。`confineSpawn` 抛错时该次钩子失败，错误为 `sandbox: …`，与其他钩子失败一样记为 `hook failed: sandbox: …`；脚本不会运行。
- **文件工具。** 文件工具在 harness 进程内运行，因此由 core 自己执行策略：`SandboxFileAccess`（`environment/tools/file-access.ts`）按调用当时的策略逐次构建，以 `ToolExecutionContext.fileAccess` 交给工具。`denyWrite` 依据写入实际落点的真实路径判定：跟随符号链接，不存在的尾段沿最深的已存在祖先解析。`workspace-write` 下允许 Workspace、scratchpad 与临时目录；`read-only` 下只允许临时目录；临时目录仅在 `writableTemp` 不为 `false` 时可写。屏蔽路径在任何模式下都拒读拒写（`denyRead`），`read_file` 的 http(s) 来源遵守网络档位（`denyUrl`）：`none` 一律拒绝，`local` 只许回环地址。被拒绝的调用以 `fatal` 收尾，给模型一句以 `Denied by the sandbox:` 开头、写明模式与可写目录的话。没有策略或沙盒关闭时，什么都不拒绝。
- **scratchpad 交给后端。** `SpawnConfiner` 的选项新增 `scratchpadDir`，服务端的 `confinerFor` 把它放进插件契约新增的可选字段 `SandboxPolicy.writableRoots`。`workspace-write` 下，bwrap 与 Seatbelt 把它加入可写根，WSL 在发行版能访问它时按转换后的路径把它绑定进发行版。不实现该字段的后端只会约束得更窄，不会更宽，因此没有为它设隔离维度。
- **文档与 Skill。** 设置（沙盒）、工具与审批（文件工具）、Agent 运行循环（钩子）、技能与插件（钩子包）、核心接口以及 Server 启动与子系统各页描述了三类执行者、可写目录与新的接缝。`agent-initialization` Skill 写明钩子在 Session 的沙盒下运行，它的钩子参考列出了 `sandbox:` 失败。

## 未覆盖

- 以 `stdio` 方式启动的 MCP Server 仍不受封禁，由宿主按配置拉起。
- 记忆与 Agent State（`AGENTS.md`、`system_config.yaml`、vault、Skill、钩子包、定时任务）仍在两种封禁模式的可写目录之外。封禁中的 Agent 写不了记忆，不能自行编写 Skill 或钩子包，也改不了自己的配置，因此同样加不进 MCP Server；这些都需要完全访问。
- 注入的 `penguin` CLI 经服务端 API 所做的改动（定时任务、插件安装）走网络而非文件系统，只受网络档位约束：无网络档位下该路径随之关闭。
- DSH 适配器只把模式与 Workspace 交给 DSH，因此在 DSH 下，命令与钩子脚本写不了 scratchpad。
- WSL 后端下钩子脚本无法运行，因为发行版里没有执行 `node <script>` 所需的 Node：每个钩子都会失败，而不会脱离封禁运行。

## 兼容性

- 策略为封禁模式的 Session，其文件工具与钩子脚本从下一次调用起受约束，已打开的对话也不例外。写记忆、Skill、钩子包与 Agent 配置会被拒绝；需要这些的对话，用它的**权限**按钮切到完全访问。沙盒关闭的 Session 不受影响。
- DSH 下，写 scratchpad 的钩子（包括目标模式的钩子）会失败；WSL 下，每个钩子都会失败。需要在这些后端上使用钩子的对话，改用完全访问运行。
- SDK：`scriptStopHook`、`scriptPreToolUseHook` 与 `scriptUserPromptHook` 原先的 `timeoutS` 与 `pathPrepend` 参数，改为以第四个参数 `{ timeoutS, pathPrepend }` 传入。
