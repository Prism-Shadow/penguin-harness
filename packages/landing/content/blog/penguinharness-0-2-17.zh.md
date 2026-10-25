---
title: "PenguinHarness 0.2.17：Agent API 记录流、A2UI 统计图与表单、远程机器"
date: 2026-10-26
category: news
excerpt: "Agent API 现在直接流式输出 Session 自身的记录，旧的 v1 事件已移除。回复能渲染统计图，表单新增多种字段类型，「轨迹观测」面板完成重做，远程机器上的对话能读取那台机器的记忆、模型等数据。"
---

PenguinHarness 0.2.17 发布了。它是一个面向 AI Agent 的开源 TypeScript Harness，包含 Web App、CLI、桌面应用、服务端和 SDK。这一版里，Agent API 会流式输出 Session 自身的记录，回复可以渲染 `chart`、`resources` 和表单块，「轨迹观测」面板完成重做，远程机器上的对话能读取那台机器的记忆、模型等数据。**如果你的代码调用了 Agent API，请先看「升级须知」**。

**TL;DR**
- Agent API 的流现在输出的是 Session 的记录；`run.*`、`K.delta` 和 `K.done` 已移除，服务端和 SDK 要一起升级
- 回复可以渲染 `chart`、`resources` 和包含十一种字段类型的表单；请更新 `a2ui` 插件
- 「轨迹观测」面板重做：轮次、上下文圆环、思考等级
- 远程机器：机器上的 Agent 作为那台机器的 Agent 列在列表里，它的对话读取的是那台机器的记忆、模型等数据

## Agent API 流式输出 Session 的记录

**路径 `/api/amsp/v1` 没有变化，流的内容就是 Trace 存储的 Session 记录**。每条记录都是一个信封，字段为 `{timestamp, type, payload, origin?}`。消息流式输出期间会出现 `partial_*` 分片。旧的 v1 事件 `run.*`、`K.delta` 和 `K.done` 已移除，服务端也不再把记录转换成这些事件。

控制帧是 `event: ping`（data 为 `{}`，立即发送，之后每 20 秒一次）和运行流结尾的 `data: [DONE]`。新建的 Session 收到第一条消息时，首条记录是 `session_meta`，它的 `session_id` 标识这个 Session。

调用方带上 Agent 密钥（以 `Bearer` 方式发送）即可访问 `/api/amsp/v1` 下的路由。`GET /sessions/:id/stream` 从 `Last-Event-ID` 续传；如果这个 id 已不在缓冲区，或者服务端重启过，就返回 `409 resync_required`。`GET /sessions/:id/messages` 返回历史消息，`GET /sessions/:id/trace-image` 返回历史里引用的图片，`GET /sessions/:id/approvals[?wait=1–60]` 长轮询等待审批的工具调用。`POST /sessions/:id/tasks` 启动的运行不占用连接；启动成功时返回 202，Session 正忙时返回 409，运行从不排队。

`@prismshadow/amsp` 发布了 0.2.17 版。`AgentClient.stream()` 和 `AgentClient.run()` 保留 0.2.16 的语义，SDK 从记录里读出 `RunResult`。SDK 把每个等待审批的工具调用交给 `onApproval`，没有回调时，答复是 `deny`。SDK 还新增了 `messages()`、`approvals()`、`SessionReader`、`HttpTransport`、`Transport` 接口、`readSse`、`readAmsp`，以及浏览器 bundle（`@prismshadow/amsp/browser`）。

Web App 里，Agent「API」标签页上的「试一试」现在通过 SDK 运行，并会列出这次运行的记录。

![「试一试」运行完成后的 Agent「API」标签页，显示记录行和结果条](/blog-assets/penguinharness-0-2-17-agent-api-zh.png)

记录本身也有变化。每个 Task 都包在一对 `task_begin` / `task_end` 记录里，任何记录都不再携带 `stop_reason`（替代字段和 TypeScript 改名见「升级须知」）。协议另有专门页面，地址是 penguin.ooo/amsp。

## 回复里的统计图与表单

A2UI 是一组块，Agent 把它们写进回复，聊天界面再把它们画成界面元素。A2UI 来自 `a2ui` 插件。本版为 A2UI 新增了两种块：`chart` 统计图和 `resources` 系统资源。

`chart` 统计图有七种，分别是 `line`、`area`（可堆叠）、`bar`（分组、堆叠或横向）、`pie`（可选环形）、`scatter`、`histogram` 和 `gauge`。七种图共用一个数据模型：类别 × 1–6 个系列，坐标轴带单位。

![一条回复，里面有分组柱状统计图和一台机器的系统资源块](/blog-assets/penguinharness-0-2-17-a2ui-charts-zh.png)

`resources` 系统资源块显示一台机器的 CPU、内存、交换分区、磁盘、网络、负载和运行时长。

表单块会一次向用户提出多个问题，现在有十一种字段类型，分别是 `text`、`textarea`、`number`、`slider`、`single`、`multiple`、`select`、`switch`、`date`、`time` 和 `datetime`。答案是否有效由一条规则决定。必填字段都填好、答案都有效后，表单按钮才可用。

已作答的表单块或选项块会显示发送出去的答案；页面刷新后如此，旧对话里也如此。答案从用户紧接着发出的那条消息里读回来，不存储任何新内容。

![一个已作答并刷新过的表单块，答案以只读方式显示](/blog-assets/penguinharness-0-2-17-a2ui-form-zh.png)

**更新 `a2ui` 插件后，Agent 就能用上这些新块（见「升级须知」）；同一次更新还让 A2UI 检查器不再给块外的文字打分**。

## 重做的「轨迹观测」面板

**一次对话的「轨迹观测」面板顶部改成一条吸顶工具栏**。工具栏上是 Trace 文件选择器、轮次按钮和一个导出图标。

轮次按钮上写着当前查看的轮次，点开会进入「轮次导航」。选中某个轮次，视图会切过去并滚动到位。

每个轮次占一行，行与行之间有分隔线。每行显示编号、工具调用数、缓存命中率、费用和耗时，行尾是一个上下文圆环。点开圆环会打开「本轮读数」，里面是这一轮的 Token 用量和上下文用量。

每个事件行用一个标签标出记录类型，颜色按记录大类区分。每个请求的思考等级现在会写进 `request_begin` 记录的 `thinking_level` 字段。等级变化的地方，视图会用文字标出，例如 `thinking_level=medium → high`。

![「轨迹观测」面板：吸顶工具栏、带分隔线和上下文圆环的轮次行、带标签的事件行](/blog-assets/penguinharness-0-2-17-trace-zh.png)

以非零值退出或被信号终止的命令，现在会在对话、Trace 和 CLI 里显示为一次正常完成的工具调用。输出末尾仍是 `[exit code: N]` 或 `[terminated by signal X]`。`fatal` 仍只用于工具自身的失败。

## 远程机器上的 Agent 与对话

**远程机器上的 Agent 与对话，现在归那台机器自己所有，由它来列出、读写**。远程机器指这台服务器通过 ssh 连接的另一台电脑（「机器管理」页面）。「智能体」页面把每台已连接机器的 Agent 列在本服务器的 Agent 旁边，每张卡片以 `[SSH: <alias>]` 命名。机器上的 Agent 可以打开、编辑、删除，也能和它对话、为它安装插件。创建 Agent 的对话框会请你选择位置：本服务器或某台已连接的机器。

![「智能体」页面：机器的 Agent 列在本服务器的 Agent 旁边](/blog-assets/penguinharness-0-2-17-machines-zh.png)

机器上的对话读取那台机器自己的记忆、模型、定时任务和 Skill（输入框里的 Skill 列表）。

机器失联时，对话页面用别名标出这台机器，并说明重连进行到了哪一步；机器一恢复，对话就自动加载回来。自动重连在连续 8 次失败后停止，遇到无法靠重试解决的 ssh 拒绝时立即停止。机器卡片提供「重试」按钮。重连停止后，机器卡片的状态标签会显示「重连已停止」。

## 本版其他更新

- **Markdown**：插件 README、Benchmark 用例和「文件浏览」面板里加了大纲和页内查找；表格在所有地方共用同一种样式。
- **外观**：强调色也会染到你自己的消息上；回复流式输出和页面加载时，自定义背景图也能透出来。
- **终端**：终端归属于打开它的那个对话；侧边栏里的终端是每个对话一个「命令行终端」面板，该对话的 shell 以标签页形式放在里面。
- **模型**：MMSP 0.5.6；模型目录加入 MiniMax M3.1 Flash 和 Kimi K3.1 Pro（TokenDance、Moonshot、OpenRouter）；「同步新增模型」会带上这些预设；`model.timeoutMs` 默认值改为 600000（10 分钟，原先 300000），已有 Agent 会在内核更新时用上这个默认值，除非该 Agent 的「运行参数」标签页改过。
- **任务与目标模式**：永远不会再触发的定时任务移到 `schedule/expired/`；目标模式在没有 goal 插件时会说明情况，并提供「安装到此 Agent」。
- **登录**：同一主机上的两个实例可以同时保持登录；Cookie 名称里带上了端口。
- **修复与安全**：复制的文本粘贴为纯文本；流式回复期间向上滚动，视图停在原处；Agent State 导入失败时保留原先的 State；Benchmark 导出在任何时区都正常；桌面应用升级到 Electron 43.8.3，依赖更新解决了 Dependabot 报出的告警。

## 升级须知

- **Windows 桌面应用**：安装包改用新证书签名，0.2.16 及更早的应用会拒绝这次更新。请从 penguin.ooo/download 手动安装一次 0.2.17，之后的更新照常进行。
- **Agent API 调用方**：v1 流的传输格式变了。服务端和 `@prismshadow/amsp` 要一起升级，或者锁定 `@prismshadow/amsp@0.2.16`（`^0.2.16` 范围会拿到新客户端）。`run.*`、`K.delta`、`K.done` 事件改为记录，心跳是 `event: ping`，过期的 `Last-Event-ID` 会得到 `409 resync_required`。AMSP 文档页把每个旧事件都映射到了对应的记录。
- **记录**：记录不再带 `stop_reason`，改读 `request_end.status` 和 `tool_call_output.status` (`completed` / `fatal` / `aborted`)。轮次到达上限时会出现一条带 `error_code: "max_turns"` 的 `abort` 记录。回复在输出上限处被截断时，以 `retryable` 结束并带 `output_truncated`，随后自动重试。每个轮次最多尝试 10 次，之后放弃（原来是 20 次）。旧 Trace 里没有 `status` 的工具结果按 `completed` 读取。
- **TypeScript**：`OmniMessage` / `OmniPayload` / `OmniMessageType` 现在是 `AmspRecord` / `AmspPayload` / `AmspRecordType`。`@prismshadow/penguin-core/omnimessage` 和 `@prismshadow/penguin-core/markers` 已移除，改为从 `@prismshadow/amsp` 或 core 根入口导入。`/docs/omni-message` 移到了 `/docs/amsp-records`，没有重定向。模型目录移到 `@prismshadow/penguin-server/model-catalog`。记录构建器去掉了 stop-reason 参数，工具返回 `{ status }`。如果数据根目录只有 SDK 在用，启动时就没有任何模型，要用 `addModel` 添加并设一个默认模型。`resolveEntryCredential` / `effectiveConnection` 取代了旧的凭据辅助函数。
- **环境变量**：系统不再读取 `PENGUIN_GO_API_KEY` 和 `PENGUIN_GO_BASE_URL`。只设了 `PENGUIN_GO_API_KEY` 的话，从 Penguin Go 分组标题那里重连，或把 key 粘贴进它的分组设置。在厂商的第二个官方域名（`open.bigmodel.cn`、`api.moonshot.ai`、`api.minimaxi.com`）上，不带 key 的模型会被拒绝，系统不再替它读厂商的环境变量。把 key 放到模型或它的分组上，或者清掉 base URL，在 key 旁边设厂商的 `*_BASE_URL`。
- **vLLM**：vLLM 模型读取 `VLLM_BASE_URL` 和 `VLLM_API_KEY`（默认 `http://127.0.0.1:8000/v1`），不再读 `OPENAI_*`。
- **定时任务**：开始时间已过的一次性任务会被拒绝，返回 400，重新启用也一样。请把开始时间改到将来。
- **反向代理**：在负责 TLS 终止的反向代理之后，设 `PENGUIN_TRUST_PROXY=1`，保留外部的 `Host` 头，并让代理把 `X-Forwarded-Proto` 覆写为 `https`。否则 Web App 的每次写操作都会被拒绝，错误为 `403 cross_origin_write`。带 body 而没有 Content-Type 的写请求返回 415。
- **远程机器**：把每台机器更新到本版（「机器管理」页面里对应机器的「更新」）。仍运行旧版本的机器，在 Web App 里收不到实时事件，它在列表里的条目仍能加载。
- **插件**：已安装的插件里，内容有变化的要更新，包括 `a2ui`（统计图、表单）、`agent-development`、`goal`、`continual-learning`、`browser-automation` 和 `use-bento-slides`。

安装包见 [penguin.ooo/download](https://penguin.ooo/download)，完整变更见 [0.2.17 更新日志](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17)。
