# 服务重启或崩溃中断的运行现在会自动续跑

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `server`、`core`、`cli`、`web`、`docs`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)

[English](2026-10-18-server-restart-auto-resume.md)

服务重启（优雅重启、崩溃或 `kill -9`）时正在跑的任务，过去会把会话晾在 `[已中断]：用户中断`，
等人发消息才继续。现在下次启动会自动续跑每一个被中断的任务：Trace 重放重建
被切断的那一轮（`[turn_aborted]` 接续），任务从断点继续。

## Details

- 每个被驱动的运行（Task、压缩、goal 循环、模型切换）在开始时于 `<数据根>/session-runs/`
  下写一条持久标记，结束时删除——除非是服务自己的关闭把它切断，标记才会留给下次启动。
  崩溃不需要关闭时写盘：死进程残留的标记就是恢复集合。
- 关闭时用服务自己的 `AbortSignal.reason` 中断运行，core 记为新的 `server_restart` 中断码
  （渲染为 "interrupted by a server restart" / "服务重启导致中断"），而不是 `user_abort`。
  先到的中断为准：人已经停掉的任务即使关闭随后而至也保持 `user_abort`，永不复活。
- 循环闸：1 小时内自动恢复 3 次后跳过该会话（删标记并记 `auto_resume_loop` 错误），
  有毒的任务不会每次启动都烧一次模型调用。任何正常结束的运行都会清掉计数。
- 排队的 follow-up 是纯内存设计，重启后丢失——只有被中断的那一轮会续跑。重启前的后台
  进程和后台子代理已经没了；续跑消息会告诉模型按需重起。
