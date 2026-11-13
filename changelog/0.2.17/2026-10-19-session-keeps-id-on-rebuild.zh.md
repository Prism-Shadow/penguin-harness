# 从未运行过的对话被服务端重建时保留原 id

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `server`, `core`
- **PR:** [#1233](https://github.com/Prism-Shadow/penguin-harness/pull/1233)

[English](2026-10-19-session-keeps-id-on-rebuild.md)

启用了消息软件机器人、却还没有运行过一轮的对话，在服务端重启后不再回复。重启后的服务端在第一条消息到来时以新 id 重建该 Session，绑定却仍留在旧 id 上：机器人照常收消息，回复无处可去，绑定指向一个已不存在的 Session。现在从未运行过的 Session 以原 id 重建，它的绑定、终端以及打开着它的页面都仍然对得上。

## 细节

- 没有 Trace 的 Session（已创建、从未运行，且运行时对象在服务端重启或空闲回收后已不在）按索引行以该行原有的 id 重建，不再换成新 id。
- 已启用绑定的 Session 在连接建立时即被载入，从未运行过的也一样，与已运行过的 Session 相同。
- SDK：`agent.createSession` 新增可选参数 `sessionId`，供宿主重建它在首次运行之前就已记下的 Session。id 只能包含字母、数字、`-` 与 `_`；该 id 已有 Trace 时拒绝创建（应改用 `resumeSession` 恢复）。
