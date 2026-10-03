# 路线图讨论室的消息能送到正忙的讨论室会话，且只在组织运行的那台机器上转发

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `server`
- **PR:** [Myriad-Dreamin/penguin-harness#59](https://github.com/Myriad-Dreamin/penguin-harness/pull/59), [Myriad-Dreamin/penguin-harness#60](https://github.com/Myriad-Dreamin/penguin-harness/pull/60)

[English](2026-09-29-roadmap-room-delivery.md)

路线图讨论室里的一条消息，现在也能送到还在干活的讨论室会话：它在正在跑的 Task 的两步之间送进去，不再排队等那个 Task 结束。以前，主持人的会话若一直没结束开场的那个 Task（它自己写循环等讨论室），讨论室之后说的话它都收不到，有人在讨论室里问它，那段循环跑多久，问题就晾多久。讨论室会话的第一条输入现在也写明：不要等讨论室，说完就结束这一轮。

只持有某个组织镜像的服务器（组织运行在另一台机器上）不再转发它的路线图讨论室。以前这样的服务器在重启后会发现讨论室会话「不见了」（它们是另一台机器上的），就在自己那份账本副本里把它们关掉，再开一套自己的，于是同一个讨论室里多出一套会话在说话。

对插件：`MessagingTaskRunner` 新增 `steer`（送进正在跑的 Task；没有时 409 `not_running`），`OrgView` 新增 `machineId`（组织不在本服务器运行时，它运行的那台机器，否则为 `null`）。插件装在比这两处都旧的服务器上也照常工作：缺 `machineId` 不会停掉转发，没有 `steer` 时每一行照旧作为 Task 启动。
