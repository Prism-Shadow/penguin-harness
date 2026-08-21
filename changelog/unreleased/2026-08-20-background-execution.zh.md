# 后台执行与完成回报,以及 kill 工具

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#376](https://github.com/Prism-Shadow/penguin-harness/pull/376)

[English](2026-08-20-background-execution.md)

为 `exec_command` 与 `run_subagent` 增加了 `run_in_background` 参数:调用立即返回 `process_id` / `subagent_id`,任务结束时其结果**以 Harness 注入的 user message** 送回会话——模型不再需要轮询。新增 `kill_command` 与 `kill_subagent` 用于终止后台会话,并把 `input_command` 空轮询的默认等待从 5000ms 提高到 120000ms,一次轮询即可等完多数构建。

## 细节

- 完成回报以 `[background_task_done]` 标记块开头(kind、id、status、一行 detail),其后是任务内容与尚未送达输出的尾部(上限 4000 字符)。Web App 将标记块折叠为一行提示,回报正文显示在其下方。
- 送达时机:Task 进行中时,回报搭乘下一个 turn 边界——最终回复已流式输出的 Task 会再延续一个 turn 来回应它;Session 空闲时,Server 自动以该回报发起新 Task;SDK 嵌入方可订阅 `Session.onBackgroundNotice` / `takeBackgroundNotices`,无订阅者时回报并入下一次 run 的输入。
- `kill_command` 向整个进程组发 SIGTERM(宽限期后 SIGKILL)并返回尚未送达的输出;`kill_subagent` 中止运行、拒绝其待审批项并移除会话(空闲会话也可移除,腾出并发额度)。被 kill 的任务不再发完成回报——kill 自身的结果已说明结局。
- user 角色的 `text` payload 增加了可选 `sender` 字段(`"user" | "parent_agent" | "harness" | "server"`):父 Agent 写给 Subagent 的 Prompt 在子 Trace 中记为 `sender: "parent_agent"`,Harness 注入的完成回报记为 `sender: "harness"`,Server 的定时任务触发记为 `sender: "server"`。该字段为纯追加——缺省即真人用户,这也是该字段出现之前所有 Trace 的正确读法——因此不涉及迁移与兼容代码,且不会进入 Provider 请求。
- 内核版本推进到 `2026-08-20`;既有 Agent 通过设置页的内核更新采纳新工具与新参数(用户自定义保留),不执行则维持原有工具集不变。
- 修复了新建会话的送达缺口:运行时只在恢复路径注册空闲回报监听,同进程新建的会话完成回报无人接收——聊天页因此不刷新。两条入表路径现在都注册,并有 Playwright 端到端测试证明(真实 server + mock LLM:回报横幅与模型后续轮在打开的聊天页上无操作自动出现)。
- 后台 Subagent 启动即亮相:其 `session_meta` 在启动时前置转发,聊天页的智能体面板在任何轮询之前就能看到该节点(服务端同步注册);面板依据 Harness 自身的注记推导后台节点的运行状态,完成回报、空闲轮询或 kill 移除都会将其置为已结束。
- 轨迹观测页把完成回报自动发起的一轮归并进启动后台工作的那一轮(仅展示层——文件与分析结果不动;Token/时长求和,上下文快照取较晚者),每轮时间线新增用户行:用户侧消息以时间点标记呈现,真人为实心圆点、机器注入为圆环,tooltip 注明来源。
