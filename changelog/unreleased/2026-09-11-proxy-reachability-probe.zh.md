# 代理选项可以测量服务器到各模型服务商的连通情况

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#686](https://github.com/Prism-Shadow/penguin-harness/pull/686)

[English](2026-09-11-proxy-reachability-probe.md)

代理选项设置页在保存行下方新增连通性测速：它先列出 OpenAI、Anthropic、Gemini、DeepSeek 以及 GLM 的
两个主机 Z.AI 与 BigModel 共六个目标及各自将被请求的具体地址，一个按钮把它们一并测一遍，对回应的主机
报出延迟；每一行各自到达即显示，不必等最慢的那个。探测在服务器上执行，接口是新增的
`GET /api/admin/settings/proxy-probe` 与 `POST /api/admin/settings/proxy-probe/:provider`
（仅管理员）——被测的正是服务器自身的出站链路，它由代理设置决定，浏览器看不到。

## 细节

- 不发送任何凭据。每次探测都是对服务商模型列表接口的一次匿名 `GET`；与协议探测不同，它不会退回到进程
  环境里的 `OPENAI_API_KEY` 之类。基础路由的 `GET` 只返回目标列表、不发起探测，页面上展示的地址因此
  就是服务端真正请求的地址。
- GLM 算两个目标而非一个：`api.z.ai` 是模型目录默认使用的国际版端点，`open.bigmodel.cn` 则是
  bigmodel.cn 的 key 所需的国内端点。两者解析与路由都不同，代理可能只通其中之一。
- 只要回了 HTTP 响应就算连通，401、403 同样算：凭据被拒也说明域名已解析、TCP 已连接、TLS 已握手、
  对方已应答。连不通指传输本身失败，归为 `timeout`、`dns`、`refused`、`tls`、`network` 之一。
- 连通的目标只显示往返毫秒数；文字状态留给没有数字的目标——连不通的和尚未测的——并随数字一同提供给
  辅助技术。
- 目标地址写死在服务端，探测路由不接受任何请求体——只接受一个 provider id，并在同一份列表里比对，
  其余一律 404 且不会发起任何网络请求，因此调用方无法指定服务器去抓取的地址。每个目标限时 5 秒，
  页面一次性把它们全部发出，某个不通的主机只会拖住它自己那一行。
- 测量描述的是已保存的设置，因为只有保存才会重建出站 dispatcher；测速因此排在「保存」下方，理由则
  放在该页原有的问号里。保存后会清掉描述旧配置的结果。
- `packages/docs/content/server-api.{zh,en}.md` 补上了这两条路由。
