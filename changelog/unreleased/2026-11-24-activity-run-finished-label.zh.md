# 状态栏只累计思考与工具调用的时间

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `amsp`, `core`, `web`, `ui-gallery`
- **PR:** [#1823](https://github.com/Prism-Shadow/penguin-harness/pull/1823)

[English](2026-11-24-activity-run-finished-label.md)

三种思考显示方式都在第一次调用工具后才显示步数。时钟只累计思考、工具参数生成和执行的时间，并行活动的重叠部分只算一次。等待审批、重试以及生成最终回复时，用时保持不变。成功结束后，对话与交互演示的状态栏都显示「运行完毕」。

实时计时会校正浏览器与服务端的时差，运行中刷新也能接续计时。恢复会话时，Trace 中的活动时间戳不占用模型的输出预算。

[既有 Trace](2026-11-24-backward-compatibility.zh.md)
