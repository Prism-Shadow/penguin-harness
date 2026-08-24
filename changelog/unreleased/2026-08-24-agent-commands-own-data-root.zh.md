# Agent 运行的命令不再继承 harness 的数据根

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`
- **PR:** [#PLACEHOLDER](https://github.com/Prism-Shadow/penguin-harness/pull/0)
- **Breaking:** yes — `PENGUIN_HOME` 与 `PENGUIN_WEB_DB` 不再传入 Agent 运行的命令；如需传递，请写入该 Agent 的 vault

[English](2026-08-24-agent-commands-own-data-root.md)

`PENGUIN_HOME` 与 `PENGUIN_WEB_DB` 加入了从 Agent 所运行命令的环境中剥离的变量之列，与 `PORT`、
`HOST` 以及 harness 自身的其他内部变量并列。由 Agent 启动的 harness 现在使用自己的默认数据根，而不是
当前正在服务的 harness 所用的那个。

## 细节

- 此前保留继承，理由是自研场景可能确实希望共用同一数据根。但继承并不等于做出了这个决定——它只是
  服务进程恰好指向哪里的副产品。而只要 Agent 在派生命令，harness 必然正在运行并持有
  `<root>/server.lock`，因此由 Agent 启动、落在继承数据根上的服务端只会以退出码 3 失败，而持锁者
  正是把这个根交给它的那个进程。
- 共用数据根依然可行，只是改为明示而非继承：Agent 的 vault 在宿主环境之后应用，因此在 vault 中设置的
  `PENGUIN_HOME` 会原样传入命令。这与 `FORCE_COLOR` 已有的逃生通道相同。
- 与其他被剥离的名称一样按大小写不敏感匹配，因此 Windows 上的 `set Penguin_Home=…` 同样会被移除。

## 兼容性

若某个由 Agent 运行的命令此前依赖从服务进程继承 `PENGUIN_HOME` 或 `PENGUIN_WEB_DB`，现在将不再收到
这两个变量，它启动的 harness 会解析到默认数据根（`~/.penguin/data`；未打包的开发实例为
`~/.penguin/dev-data`）。磁盘上的数据不受影响，也不会执行任何迁移。如需为某个 Agent 恢复原有行为，
将 `PENGUIN_HOME`（以及原本设置过的 `PENGUIN_WEB_DB`）加入该 Agent 的 vault，其值会与此前完全一致地
传入命令。
