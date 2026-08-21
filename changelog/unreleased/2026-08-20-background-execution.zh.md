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
- 内核版本已推进(现为 `2026-08-21`);既有 Agent 通过设置页的内核更新采纳新工具与新参数(用户自定义保留),不执行则维持原有工具集不变。
- 修复了新建会话的送达缺口:运行时只在恢复路径注册空闲回报监听,同进程新建的会话完成回报无人接收——聊天页因此不刷新。两条入表路径现在都注册,并有 Playwright 端到端测试证明(真实 server + mock LLM:回报横幅与模型后续轮在打开的聊天页上无操作自动出现)。
- 后台 Subagent 启动即亮相:其 `session_meta` 在启动时前置转发,聊天页的智能体面板在任何轮询之前就能看到该节点(服务端同步注册);面板依据 Harness 自身的注记推导后台节点的运行状态,完成回报、空闲轮询或 kill 移除都会将其置为已结束。
- 修复后台 Subagent 在首个读写工具上永久卡死的问题:子会话审批此前只能经轮询窗口的 sink 解决,而 `run_in_background` 启动从不开窗——其命令表现为挂起或 aborted。现在启动时把该调用自身的审批回调挂为常驻 sink,子会话中止信号完全独立(仅 `kill_subagent`、Session 终结或淘汰会结束它),消息经发起 Session 实时流向前端而非等待首次轮询;失败与其他终态一样以 `status: failed` 回报收尾。成功与失败双路径均有 Playwright 端到端验证(发送后零操作)。
- 完成回报的聊天渲染改为工作分组「运行完毕」摘要行同款的可折叠一行——同底色、同标题样式、同贴顶吸附行为,样式取自单一抽取源(`disclosure-row.tsx`,其行/分组头/卡片类常量由思考块、工具卡与工作分组共同引用):折叠只显示结论(「后台命令完成」/「后台任务失败」),展开以工具卡输出样式呈现句柄、退出详情与输出尾部。轨迹观测页上,回报触发的任务保持独立一轮。
