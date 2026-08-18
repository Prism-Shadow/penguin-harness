# 管理员代理选项：应用/Agent 两个开关与显式代理地址

- **Date:** 2026-08-06
- **Type:** feature
- **Scope:** `server`, `web`, `desktop`, `core`
- **PR:** [#225](https://github.com/Prism-Shadow/penguin-harness/pull/225), [#233](https://github.com/Prism-Shadow/penguin-harness/pull/233)

[English](2026-08-06-system-proxy-switch.md)

侧边栏用户菜单新增一个仅管理员可见的「代理选项」入口，打开一个设置对话框——服务端全局，存放在新的 `server_settings` 表中，由 `GET/PUT /api/admin/settings` 提供服务——实现（并进一步扩展）了那份早已成文的「出网与系统代理」设计，使得使用代理完全不需要任何环境变量。

- 两个互相独立的开关共用一个地址：
  - **应用使用代理**（默认开）——服务端自身的出网流量（LLM 请求、更新检查、图片抓取）。Node 内置的 fetch 会忽略代理变量，因此服务端把自己的全部流量都路由经一个在入口处安装一次的 undici 全局 dispatcher。开且填了地址 = http 与 https 都用该地址；开但未填 = 使用 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量（两种大小写写法）；关 = 始终直连。
  - **Agent 环境使用代理**（默认开）——命令子进程的环境策略。开且填了地址 = 注入 `HTTP_PROXY`/`HTTPS_PROXY`（两种写法）以及合并后的 `NO_PROXY`，覆盖继承来的取值；开但未填 = 原样透传宿主环境；关 = 剥离代理变量（保留 `NO_PROXY`）。SDK 的接缝是 `proxyEnv?: () => ProxyEnvPolicy | null`（strip / inject / null 透传；不提供即维持独立运行时的原有行为，子 Agent 继承）。
- 代理地址接受 `http://host[:port]`、`https://host[:port]` 或裸的 `host[:port]`（规范化为 `http://…`）；其他一律 `400 invalid_proxy_url`；留空则清回「跟随系统代理」。该对话框是一个带显式保存按钮的表单（无改动时保存为空操作并给出 toast）；校验错误行内呈现。
- 在任何开启状态下，生效的 `NO_PROXY` 都始终包含 `localhost,127.0.0.1,::1`，使环回流量——就绪探测、SSE、工作区预览——不经任何代理。切换会立即作用于新建连接，无需重启。由 CLI 托管的服务端（`penguin web`）享有同样的覆盖。
- 桌面端：外壳在启动时解析操作系统代理（Electron 的 `resolveProxy`；采用 PAC 的 `PROXY`/`HTTPS` 结果，SOCKS 刻意跳过——undici 只讲 HTTP(S) 代理），并把它注入内嵌服务端的环境，且不覆盖已显式配置的取值——因此在桌面上，「跟随系统代理」真的就是操作系统的代理设置。
- 那个过渡期的单一 `useSystemProxy` 开关（从未发布）在两个新开关的键缺失时，会被读取一次作为它们的回退默认值。
