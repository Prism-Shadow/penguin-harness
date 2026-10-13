# 服务端：Google 官方 Gemini 端点恢复可用

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1088](https://github.com/Prism-Shadow/penguin-harness/pull/1088)

[English](2026-10-13-gemini-global-fetch.md)

发往 Google 官方 Gemini 端点的请求在服务端进程内、尚未发出就失败，报错 `Unexpected HTTP client error: TypeError: Failed to parse URL from [object Request]`。原因是服务端启动时把 `globalThis.fetch` 换成了 npm `undici` 包的 fetch，而 Gemini SDK 的每个请求都用运行时自带的 `Request` 类构造，这个 fetch 不认。现在启动时只安装代理 dispatcher，所有出网请求都由运行时自带的 fetch 发出，它读取的是同一个进程级 dispatcher。

## 细节

- 管理员代理设置照旧生效：应用程序开关、显式的 `http(s)://` 或 `socks5://` 地址、代理环境变量，以及本地目标直连。修改设置后，下一个请求即按新设置发出，无需重启。
- 用全局 `FormData` 类构造的请求体经全局 fetch 发出时，现在按 multipart 发送，不再变成文本 `[object FormData]`。
