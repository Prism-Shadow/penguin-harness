# 服务端重启后对话不再一直转圈，被拒绝的流 id 也不再被反复送上去

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1198](https://github.com/Prism-Shadow/penguin-harness/pull/1198)

[English](2026-10-18-web-stream-reconnect.md)

服务端重启后打开会话，对话内容不会再永远停在骨架屏上；输出流也不会再带服务端刚刚拒绝的那个会话 id 去重连。

## 细节

- `loading`（消费方渲染骨架屏所依据的标志）改由 `load()` 自己的 `finally` 落位，不再只在它原有的两条"干净"出口上清除。`load()` 另有五处提前 `return`（取历史途中被 rebuild 顶掉 epoch、controller 已 dispose、replay 循环把剩余事件交给更新的那一轮），每一处都会把该标志留在 true：一个永不结束的转圈，既没有报错，也没有重试入口。现在用一个在途计数判断归属：被顶替的一轮在新的 load 仍在取历史时不清标志，最后一个落地的轮次清且只清一次。controller 已 dispose 时直接跳过更新，此时屏幕上没有任何需要落位的东西。
- 收到 `resync_required` 会让流作废它记住的事件 id，直到真正打开一条新连接为止，重连于是以全新订阅的身份发出，而不是把服务端刚拒绝的那个 id 再送一遍。连接一旦被授予，记录随之恢复，此后的一次重连照旧可续。被拒绝的那条连接上后续到达的 id 同样不记录——真实的 `EventSource` 会在每一帧（包括 ping）上重复上报它最后见到的 id。
