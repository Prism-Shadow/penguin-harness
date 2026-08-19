# 重启客户端后的压缩，以及压缩被拒时的本地化原因

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `docs`
- **Breaking:** yes — `POST /compact` 三种拒绝原因中的两种从共用的 `nothing_to_compact` 错误码移到了 `compaction_not_configured` 与 `already_compacted`。

[English](2026-08-19-compact-after-restart.md)

重启客户端后立刻请求压缩，无论对话实际有多长，都会被拒绝并提示「The current context has nothing to compact (no completed conversation turns yet)」。`Session.compactability()` 把问题转交给 `ContextEngine`，而这个引擎是由第一次 run 的 bootstrap 才创建的——于是在进程重启到下一个 Task 之间根本没有引擎可问，转交便退回到字面上的 "empty"。现在可压缩性依据 Trace 回放恢复出的状态来回答，压缩被拒的三种原因也以读者的语言抵达界面，而不再是一句英文散文。

## 细节

- 在引擎尚未创建时，`Session.compactability()` 读取回放得到的 `sessionTurns`，因此恢复出来的对话无需先跑一个 Task 就可以压缩。在本进程内新建的 Session 仍然报告 `empty`，唯一一次请求就被中断的 Session 也仍然报告 `empty`——这两种情况正是这个原因存在的意义。
- 当压缩确实可用时，`Session.compact()` 会创建引擎，让 bootstrap 把恢复出的历史注入 LLM，而不是返回一个空的流、把调用方晾在那里等一个永远不会出现的压缩横幅。从未运行过的 Session 依然是严格的空操作，不写入任何 Trace 记录，因此一个没被碰过的会话不会因为被压缩而变得可恢复。
- 可压缩性规则被提取为 `context-engine.ts` 中导出的 `compactAvailability`，由引擎和恢复出的 Session 共用，两处答案不会各自漂移。
- 恢复流程会从 Trace 收尾的那次压缩还原 `fromCompaction`（`EngineInitialState.fromCompaction`，源自 `contextClosed`）。刚压缩完就重启，得到的回答是「刚刚压缩过」，而不是告诉用户还没说过话——两种状态的轮次都是零，但它们不是同一句话。
- `POST /compact` 让每一种拒绝各自拥有错误码，而不再共用一个：`compaction_not_configured`、`nothing_to_compact`（尚未完成一轮对话）与 `already_compacted`。客户端按错误码做本地化，共用一个码就只剩两个选择：用一句含糊的话覆盖三种处境，或者让英文原文出现在非英文界面里。
- Web 的错误码表补齐了这三种原因，以及普通会话会真实遇到、却一直没有译文的那些码——资源失效的竞态（`session_not_found`、`approval_not_found`、`process_not_found`、`process_running`、`trace_not_found`、`memory_file_not_found`、`memory_scope_not_found`）、Project 成员与删除的拒绝（`already_member`、`already_owner`、`project_not_found`、`cannot_delete_last_project`）、关停与删除的竞态（`shutting_down`、`agent_deleting`、`session_deleting`），以及 `workspace_not_found`、`skill_too_large` 和兜底的 `internal`——两种语言都补上了。

## 兼容性

`/compact` 三种拒绝中的两种换了错误码：原本以 `nothing_to_compact` 抵达的 409，在原因对应时现在会以 `compaction_not_configured` 或 `already_compacted` 抵达。`nothing_to_compact` 的含义不变——尚未完成一轮对话——HTTP 状态码不变，错误体的结构也不变。只渲染 `error.message` 的客户端无需改动。
