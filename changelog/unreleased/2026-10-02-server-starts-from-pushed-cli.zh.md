# server 从推送来的 CLI 启动，入口随推送加一次重启更新

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `cli`, `desktop`, `server`, `hmr`

[English](2026-10-02-server-starts-from-pushed-cli.md)

- 数据根里有推送来的 CLI 时，`penguin server` / `penguin web` 的 supervisor 经它（`penguin-hmr`）启动 server 子进程，包括首次启动、server 每次请求的重启，以及 CLI 在没有运行中的 server 时自行拉起的那一个。没有推送过，或记录指向的 bundle 已不在仓里时，仍用安装时的 CLI 启动。
- 桌面端拉起内嵌 server 的方式相同：数据根里有推送来的 CLI 就经它启动，没有就用随应用打包的 server。
- server 入口一侧的代码（比如进程入口、终端 WebSocket 握手）现在随推送加一次重启送达安装，不必重装。推送本身仍不重启 server。
- 经推送来的 CLI 启动的 server，导出的 `PENGUIN_CLI_ENTRY` 就是推送来的 CLI（`penguin-hmr` 加载器），所以推送落地后，Agent 调用的 `penguin` 与 Web App 的自更新都运行推送来的 CLI；`penguin update` 改为按进程实际运行的脚本识别安装方式，从加载器找到所在的安装。桌面应用一并打包了这个加载器。
- 推送的 CLI 包启动不了时，推送以 `400` 被拒，并写明错误，什么都不落地。在把推送交给升级流程之前，先按启动路径的方式启动一次这个包：在独立进程里，用本安装的 `penguin-hmr` 加载器在一个临时数据根上以 `--version` 运行它。按 sha 引用的 CLI 从仓里读出，用的是 HMR 控制对象新暴露的 `readBlob`。没有这道检查的话，坏掉的 CLI 会让 server 在下一次重启时起不来，因为现在每条启动路径都走推送来的 CLI。
