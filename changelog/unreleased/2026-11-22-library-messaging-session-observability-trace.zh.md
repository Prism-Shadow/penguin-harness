# messaging、session、observability 与 trace 域的服务并入 library 包

- **Date:** 2026-11-22
- **Type:** refactor
- **Scope:** `server`, `library/messaging`, `library/session`, `library/observability`, `library/trace`, `library/http`, `library/agent`
- **PR:** [#1718](https://github.com/Prism-Shadow/penguin-harness/pull/1718)

[English](2026-11-22-library-messaging-session-observability-trace.md)

服务端的用量统计、日程、messaging 与 trace 服务搬到它们之前的词汇包旁边。`@prismshadow/penguin-library-observability` 收下用量统计服务及其日期助手；`@prismshadow/penguin-library-session` 收下日程路由、日程文件存储与助手；`@prismshadow/penguin-library-messaging` 收下 messaging 域的 bridge 与各连接器；`@prismshadow/penguin-library-trace` 收下 trace 索引、trace 服务、成本计算、读取助手、history 线格式词汇、history 读取的两条流式腿以及 trace 域的路由工厂；`@prismshadow/penguin-library-http` 收下 socket 协议件与 event-stream 助手；`@prismshadow/penguin-library-agent` 收下 Agent State 快照服务。

服务端 import 这些包；library 里没有任何代码反向 import 服务端。搬动的服务在绑定服务端能力的地方保留原装配：Provider Module 留在原地，服务类搬走。API 的导出面通过 re-export 保持完整——仍在使用的仓内转发让旧 import 路径继续可用——其余一律直接 import library 包。

## Details

- `library/observability` 增：`usage-service` 与其日期助手，错误词汇从包索引导出。
- `library/session` 增：日程路由、日程文件存储与助手、`ScheduleDefinition` 类型随其 re-export，以及组织运行时日程助手的家。
- `library/messaging`（新）：messaging bridge、飞书／Telegram／QQ 连接器及其线格式词汇，messaging 契约为服务端模块 re-export。
- `library/trace` 增：trace 索引与 trace 服务、成本计算与本地日期助手（pricing tier 类型随其 re-export）、trace 读取助手与 history 线格式词汇、session history 读取及其两条流式腿、trace 域的路由工厂。
- `library/http` 增：socket 协议件（socket frames、credit window、stream answer、line frames、SSE text）与 event-stream 助手，socket 与 trace history 腿共用同一套线格式词汇。
- `library/agent` 增：Agent State 快照服务。
- 涉及的每个接口类都以 `@Interface` 装饰器声明成员。
