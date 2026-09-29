# 钩子包随模型上下文读取，`user_prompt` 钩子在每条 Prompt 上运行

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `plugins`, `docs`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)
- **Breaking:** yes — 进程内的 `user_prompt` 钩子（`SessionConfig.hooks.userPrompt`）除非标记 `trigger: "host"`，否则在每条 Prompt 上运行；`Session.runUserPromptHook` 只找得到这样标记的钩子

[English](2026-09-29-hooks-per-context-and-every-prompt.md)

钩子包成为模型上下文装配内容的一部分，每次开启上下文都重新读取；`user_prompt` 钩子点改为在用户每次提交 Prompt 时运行。这一改动让 Agent 在对话中写进自己 `agent_state/hooks/` 的钩子包在该对话的下一次压缩时生效，而不必等到下一个对话；agent-initialization Skill 也经过重写，教 Agent 如何创建、安装和导入 Skill 与钩子包。

## 细节

- **钩子随模型上下文读取。** `Agent.assembleContext` 在每次开启上下文时读取 `agent_state/hooks/` 与 `hooks.enabled`：创建 Session 时、压缩开启的上下文中，以及恢复时。`openNextContext` 以 `SessionOpenedContext.hooks` 交回新上下文的钩子，Session 用它整体替换自己的钩子（`adoptHooks`），空列表也不例外，因此卸载最后一个包同样能作用到运行中的对话。每次咨询都在发生时读取 Session 当时的钩子，所以一次 `run` 调用中途的压缩会把这次调用的剩余部分交给新上下文的钩子。经 API 安装、导入或卸载钩子包，或写入 `hooks.enabled` 时，服务端仍使该 Agent 缓存的运行时失效，插件库的安装正是靠这一点在已打开对话的下一个 Task 生效。
- **每条 Prompt 都运行 `user_prompt`。** 引擎新增咨询缝 `RunOptions.userPrompt`（`UserPromptFn`），由 `Session.run` 为本次调用的第一个 Task 接上。`run` 的输入含 `sender` 缺省或为 `user` 的 user 文本时触发；`server`、`harness` 与 `parent_agent` 输入、stop hook 的续跑输入以及插话都不触发。钩子按包名顺序、再按清单顺序运行，stdin 为 `{ hook: "user_prompt", session_id, trace_path, scratchpad_dir, prompt }`（`trace_path` 是这个钩子点新增的字段；`prompt` 是用户的各条文本以换行相连、剥离开头标记块后的结果），stdout 为 `{ "context": "…" }`。
- **context 的去处。** 每个非空 context 成为一条带 `sender: "harness"` 标记的 user 文本：推到流上，紧随 Prompt 写入 Trace（排在首次运行的 bootstrap 记录之前），并追加到首个请求的输入中。成功不留 `hook` 事件。失败（退出码非零、stdout 不是 JSON、超时或抛错）在同一位置记为一条 `hook: "user_prompt"` 的 `hook` 事件，以错误信息为 `reason`，除此之外按无意见处理；`HookPayload.hook` 因此新增 `"user_prompt"`。
- **宿主触发的命令。** `user_prompt` 命令新增可选字段 `trigger`：`"prompt"`（缺省）或 `"host"`。`host` 命令不参与每条 Prompt 的咨询，只经 `Session.runUserPromptHook(name, prompt, extras)` 运行；该方法只找包里 `trigger: "host"` 的钩子，找不到时返回 null，并且同样传入 Session 的 Trace 路径。zip 导入路由（`POST …/hooks/archive`）拒绝这两个取值之外的 `trigger`。此次改动之前写下的清单按一条兼容规则读取，见[向后兼容](2026-09-29-backward-compatibility.zh.md)。
- **手写清单。** `hooks.json` 改为宽容读取（core 的 `state/agent-state.ts` 中的 `readHookManifest` / `readHookCommands`），因为 `agent_state/hooks/` 下任何带清单的目录都是钩子包：清单没有列出的钩子点读作 `[]`；没有字符串 `command` 的条目、或命令解析到包目录之外的条目被丢弃，不是正数的 `timeout` 与未知的 `trigger` 同样丢弃；清单不是 JSON 对象的目录不算钩子包；不是字符串的展示字段读作缺省。对只列出 `user_prompt` 的清单，`GET …/hooks` 不再返回 500。
- **goal 的轮次。** core 导出 `isHookContinue(msg)`，用于识别 stop 钩子的 `continue` 事件。服务端的 goal 旁听（`goal_round` 事件）与 CLI 的 goal 渲染，只在 `continue` 事件预告之后才把带 harness 标记的输入计为一轮；第 1 轮在服务端仍是种入的输入，在 CLI 仍是第一条钩子输入。因此，随 goal 启动而来的其他钩子包的 context 不会开启新的一轮。
- **插件。** `goal` 升至 `2026.09.29.1`，其 `start.mjs` 标记为 `trigger: "host"`。`continual-learning` 升至 `2026.09.29.1`：它的任务窗口从这批输入的第一条记录开始——用户消息、随附的图片，以及紧随其后的 harness 文本——因此摘录保留了用户的原始请求。`agent-tuning` 附带重写后的 `agent-initialization` Skill，教 Agent 如何创建、安装和导入 Skill 与钩子包。
- **Web App 与文档。** 钩子标签页的对话导入 Prompt 写明了可选的 `trigger`，允许省略用不到的钩子点，并给出带 `trace_path` 的 `user_prompt` stdin。Agent 运行循环、技能与插件、目标模式、OmniMessage 协议、核心接口、Session 与 Trace 以及配置参考各页描述了新的约定。

## 兼容性

- 经 `SessionConfig.hooks.userPrompt` 注册的进程内 `UserPromptHook` 会在用户每次提交 Prompt 时运行；对没有标记 `trigger: "host"` 的钩子，`Session.runUserPromptHook` 返回 null。钩子属于嵌入方自己发起的流程时，给它加上 `trigger: "host"`。
- 手写的 `hooks.json` 中，只应在宿主启动时运行的 `user_prompt` 命令，给该命令加上 `"trigger": "host"`。
- 此次改动之前安装的钩子包在更新之前沿用旧的读法，见[向后兼容](2026-09-29-backward-compatibility.zh.md)。请从插件库更新 `goal` 插件。
