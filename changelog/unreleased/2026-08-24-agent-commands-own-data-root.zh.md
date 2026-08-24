# Agent 运行的命令不再继承 harness 自身的环境变量

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`
- **PR:** [#434](https://github.com/Prism-Shadow/penguin-harness/pull/434)
- **Breaking:** yes — 任何 `PENGUIN_*` 变量都不再传入 Agent 运行的命令；需要哪些请写入该 Agent 的 vault

[English](2026-08-24-agent-commands-own-data-root.md)

所有 `PENGUIN_*` 变量都会从 Agent 所运行命令的环境中剥离，与 `PORT`、`HOST` 以及 harness 自身的其他
内部变量一并处理。由 Agent 启动的 harness 现在使用自己的默认数据根，而不是当前正在服务的 harness 所用
的那个，也读不到该安装的其他任何设置。

匹配按前缀而非逐个名称。编写本条目时 harness 共读取 25 个此类变量，而逐名清单只覆盖了 7 个；清单总是
要在无人想起它的时刻被记起，因此改为前缀匹配后，将来新增的变量无需改动此处即可获得同样的保护。

## 细节

- 出站代理设置是有意的例外，不受影响：它们是 `HTTP_PROXY` 一族，由宿主的代理策略管理，并非
  `PENGUIN_*`。`PENGUIN_TRUST_PROXY` 只是名字像——它决定服务端是否信任入站的 `x-forwarded-proto`。
- `PENGUIN_HOME` 与 `PENGUIN_WEB_DB` 此前保留继承，理由是自研场景可能确实希望共用同一数据根。但继承并不等于做出了这个决定——它只是
  服务进程恰好指向哪里的副产品。而只要 Agent 在派生命令，harness 必然正在运行并持有
  `<root>/server.lock`，因此由 Agent 启动、落在继承数据根上的服务端只会以退出码 3 失败，而持锁者
  正是把这个根交给它的那个进程。
- 共用数据根依然可行，只是改为明示而非继承：Agent 的 vault 在宿主环境之后应用，因此在 vault 中设置的
  `PENGUIN_HOME` 会原样传入命令。这与 `FORCE_COLOR` 已有的逃生通道相同。
- 与其他被剥离的名称一样按大小写不敏感匹配，因此 Windows 上的 `set Penguin_Home=…` 同样会被移除。

## 兼容性

若某个由 Agent 运行的命令此前依赖从服务进程继承任何 `PENGUIN_*` 变量，现在将不再收到
它们，它启动的 harness 会解析到默认数据根（`~/.penguin/data`；未打包的开发实例为
`~/.penguin/dev-data`）。磁盘上的数据不受影响，也不会执行任何迁移。如需为某个 Agent 恢复原有行为，将其所需的变量加入该 Agent 的 vault，这些值会与此前
完全一致地传入命令。
