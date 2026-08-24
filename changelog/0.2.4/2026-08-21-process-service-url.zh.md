# 后台进程列表的服务链接

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#376](https://github.com/Prism-Shadow/penguin-harness/pull/376)

[English](2026-08-21-process-service-url.md)

会话页的后台进程列表在 pid 旁新增了可点击的服务链接,指向运行中进程所服务的地址。检测在 core 层完成,双源:命令会话对自身输出流做增量本机 URL 扫描(剥 ANSI、监听通配主机归一为 `localhost`、取最新命中——前台与后台运行天然同覆盖,不依赖模型轮询);进程没打印 URL 时,按其进程组做监听端口探测并合成 `http://localhost:<port>`(linux 用 `ss`+`ps`,macOS 用 `lsof -g`,Windows 用 `Get-NetTCPConnection` + CIM 进程树;多个端口取最小)。

## 细节

- 输出打印的 URL(可能带路径)始终优先于端口探测合成的地址。探测在拉取进程列表时触发,按会话 TTL 缓存并带单次探测硬超时;探测失败保留旧结果,探测成功但无监听则清除。
- 进程 API 的行以追加方式新增可选 `serviceUrl`;Web App 仅在运行中的行渲染,新标签页打开。
