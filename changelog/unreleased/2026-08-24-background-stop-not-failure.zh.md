# 被停止的后台命令回报为「已停止」而非「失败」

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[English](2026-08-24-background-stop-not-failure.md)

以 `run_in_background` 启动、最终死于 SIGTERM 的命令，此前以
`Background command failed: … — terminated by signal SIGTERM` 送达对话。SIGTERM 几乎总是有人
主动把进程停掉，这条提示却读起来像崩溃——而 Session 空闲时收到的回报会自行发起一个 Task，于是
模型被唤醒，又把用户刚停掉的 dev server 重新拉起来。

## 详情

- 从 Web App 进程列表停止后台进程，现在**完全不发完成回报**——与 `input_command` 的 `kill`、
  以及被显式 `abort` 的子会话轮享有同样的沉默。按下停止的人亲眼看着那一行停下，对话没有需要
  回应的事。
- 其余的主动停止改以新的 `status: stopped` 回报，不再是 `failed`：从外部递来的停止信号
  （`SIGTERM`/`SIGINT`/`SIGHUP`——同进程组终端里的 Ctrl-C、`pkill`、停掉 dev server 的管理
  进程），以及 Harness 强制的停止（容量淘汰、空闲回收）。回报的 `[background_task_done]` 块
  直白写明：该进程是被人主动结束的，无人要求就不要重启。
- `failed` 留给无人要求的结局——spawn 错误、非零退出、硬杀与故障信号，OOM 杀进程依旧如实读作
  失败。
- `input_command` 的 `kill` 作用于已退出的进程时，对停止信号采用同一套措辞（「stopped by
  SIGTERM」而非「terminated by signal SIGTERM」）。
- Web App 的提示卡片增加第三种结局：「后台命令已停止」，用中性的方块图标，而不是红色失败叉。
