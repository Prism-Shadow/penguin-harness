# 机器的 JSON 应答在链路上压缩传送，未变的只回 304

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1396](https://github.com/Prism-Shadow/penguin-harness/pull/1396)

[English](2026-10-29-machine-answers-compressed.md)

服务端转发给机器的每个请求现在都要求压缩的应答；转发过的读取再次转发时，带上所保留应答的校验值，未变的应答经 ssh 链路只回一个几百字节的 304，不再送回整份正文。从前每次打开远程对话，模型列表、Agent 的 Skill 与配置这三项约 140 KB 的 JSON 原文都要经这条链路送一遍。

## 细节

- 每台服务端对 `/api/` 与 `/server/` 下 1 KiB 及以上的 JSON 应答，按调用方的接受情况压缩：接受 brotli 即 br（质量 6），否则 gzip，两者都不接受即原文；`q=0` 视为拒绝。
- 每个 GET 的 200 JSON 应答带一枚由其字节算出的弱 `ETag`（路由自己设了的沿用它），请求的 `If-None-Match` 与之相符即答 304、不带正文。
- 服务端转发给机器时（`/server/<machineId>` 代理与 Session 级转发），以自己的名义询问 `br, gzip`，不转交调用方的 `Accept-Encoding`、`If-None-Match` 与 `If-Modified-Since`，并在交给调用方之前先解码。不带编码作答的机器照旧原样转交。
- 服务端在内存中按机器、发起请求的用户与路径保留每项读取最近一次的这类应答，下一次转发同一读取时重新验证：机器答 304 即以保留的正文作答，答出新内容即替换。每次读取都先问过机器才作答。超过 2 MiB 的应答不保留，保留总量超过 16 MiB 时最久未用的先丢；机器被移出 Project 或卸载时它的应答一并丢弃；热推送或重启后从空开始。
- 转交的应答不再带机器的 `Transfer-Encoding`。
