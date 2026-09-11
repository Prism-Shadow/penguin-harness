# 代理选项可以测量服务器到各模型服务商的连通情况

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#686](https://github.com/Prism-Shadow/penguin-harness/pull/686)

[English](2026-09-11-proxy-reachability-probe.md)

代理选项设置页新增连通性测速：一个按钮依次探测 OpenAI、Anthropic、Gemini 与 DeepSeek，逐个报告对方
是否回应、往返耗时多少。探测在服务器上并发执行，接口是新增的 `POST /api/admin/settings/proxy-probe`
（仅管理员）——被测的正是服务器自身的出站链路，它由代理设置决定，浏览器看不到。

## 细节

- 不发送任何凭据。每次探测都是对服务商模型列表接口的一次匿名 `GET`；与协议探测不同，它不会退回到进程
  环境里的 `OPENAI_API_KEY` 之类。
- 只要回了 HTTP 响应就算连通，401、403 同样算：凭据被拒也说明域名已解析、TCP 已连接、TLS 已握手、
  对方已应答。连不通指传输本身失败，归为 `timeout`、`dns`、`refused`、`tls`、`network` 之一。
- 目标地址写死在服务端，接口不接受任何请求体，因此调用方无法指定服务器去抓取的地址。每个目标限时
  5 秒，四个并发执行，一个不通的主机不会拖慢其余三个。
- 测量描述的是已保存的设置，因为只有保存才会重建出站 dispatcher。响应因此附带本次探测所走的代理配置，
  页面在结果下方注明；保存后会清掉描述旧配置的结果。
