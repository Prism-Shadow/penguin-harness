# 重启这一步不再向运行时认领任何东西

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`
- **PR:** [#615](https://github.com/Prism-Shadow/penguin-harness/pull/615)

[English](2026-09-04-restart-claims-nothing.md)

把当前平台热推送到任何已安装的发布版本上，都会在启动时被拒绝：`this runtime publishes no business capabilities this platform can claim (config: missing supervised) — update the installation itself`。软件更新弹窗的重启步骤把 `runtime:lifecycle` 加成了运行时的必需能力，把 `supervised` 加成了运行时所发布 `config` 的必需成员，而已安装的每个发布版本都早于这两者，于是没有任何现存安装能接受推送。这项能力被移除：重启这一步现在完全在平台内部完成，带着它的平台能在任何运行时上启动。

## 细节

- 监督进程的宣告 `PENGUIN_SUPERVISED=1` 由平台直接从进程自己的环境变量读取；它是这项能力所承载的唯一事实，却被发布了两次。
- 为监督进程而退出，走的是运行时自己的优雅关闭——它注册在 SIGTERM 上的那一个——在进程内触发，并预先把 core 的 `SERVER_RESTART_EXIT_CODE` 放进 `process.exitCode`；关闭流程尊重预设的退出码而不再强制为 0。以事件方式触发而不是发信号，因为 Windows 不投递信号。
- 移除了 `LifecycleService`、`runtime:lifecycle` 资源、运行时接口描述符里的 `lifecycle` 与 `config.supervised` 条目，以及服务器配置里的 `supervised`。`penguin server|web` 的监督方式与之前完全相同。
- 对于有监督进程的运行时没有任何变化：「重启并更新」会真的重启它。在其他运行时上，路由回答 `no_supervisor`，一如既往。
- 在更新弹窗与本次改动之间从 `main` 构建的运行时，其关闭流程强制退出码为 0，经它请求的重启会停掉服务而没有人拉起；没有任何发布版本落在这个窗口里，重新构建一次即可越过它。
