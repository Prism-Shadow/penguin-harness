# 被停止的后台命令回报为「已停止」而非「失败」

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[English](2026-08-24-background-stop-status.md)

以 `run_in_background` 启动、最终死于 SIGTERM 的命令，此前以
`Background command failed: … — terminated by signal SIGTERM` 送达对话。SIGTERM 几乎总是有人
主动把进程停掉，而面对「失败」的 dev server，模型合理的反应正是把它重新拉起来，把刚做的停止
撤销。回报照发，只是换成它本该有的措辞。

## 详情

- 被人主动结束的命令改以新的 `status: stopped` 回报：用户在 Web App 进程列表按下的「停止」、
  从外部递来的停止信号（`SIGTERM`/`SIGINT`/`SIGHUP`——同进程组终端里的 Ctrl-C、`pkill`、停掉
  dev server 的管理进程），以及 Harness 强制的停止（容量淘汰、空闲回收）。
- 提示正文变为 `Background command stopped: … — stopped by SIGTERM`，其
  `[background_task_done]` 块直白写明：该进程是被人主动结束的，无人要求就不要重启。
- `failed` 留给无人要求的结局——spawn 错误、非零退出、硬杀与故障信号，OOM 杀进程依旧如实读作
  失败。
- `input_command` 的 `kill` 作用于已退出的进程时，对停止信号采用同一套措辞（「stopped by
  SIGTERM」而非「terminated by signal SIGTERM」）。
- Web App 的提示卡片增加第三种结局：「后台命令已停止」，用中性的方块图标，而不是红色失败叉。
