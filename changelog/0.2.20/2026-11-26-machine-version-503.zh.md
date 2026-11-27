# 连接机器时等其服务端启动完成，拒绝时附上服务端给出的原因

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1891](https://github.com/Prism-Shadow/penguin-harness/pull/1891)

[English](2026-11-26-machine-version-503.md)

在「机器」页连接远程机器时，若该机器的服务端仍在启动，「同步配置」一步不再以 `Config not synced — could not ask that machine what it runs: it answered 503 when asked its version` 失败。机器的服务端在 App 构建完成前就已绑定端口，在此之前对每个请求都应答一个要求重试的 503；而这段时间里它的状态已显示为运行中，因此连接、安装或重启后会过早地询问它运行的版本。现在「机器」任务向机器服务端提出的问题（版本、握手与配置同步）会等过这一应答，最长一分钟；重启也以 App 作答为完成，而不是端口可连。被本服务端中止的任务立即停止等待。

机器的服务端应答非 200 时，任务在状态码之后附上它给出的原因，例如平台未能启动的机器显示 `it answered 503 when asked its version: penguin-server has no running platform: <原因>`。原因取 API 错误信息，否则取应答的第一行，最长 200 个字符。握手与模型同步的询问同样如此。
