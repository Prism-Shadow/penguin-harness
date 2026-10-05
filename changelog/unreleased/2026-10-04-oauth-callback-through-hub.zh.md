# 为远程机器上的模型授权 API key，授权页能经 hub 跳回来了

- **Date:** 2026-10-04
- **Type:** fix
- **Scope:** `server`, `web`

[English](2026-10-04-oauth-callback-through-hub.md)

为远程机器上的分组「授权新建 API key」时，回调地址写成了那台机器自己的 loopback，授权通过后浏览器跳到一个永远打不开的页面。

## 改动

- **hub 告知浏览器的位置：** hub 转发给机器的每个请求（`/server/<machineId>/api/…`）都带上 `X-Forwarded-Host`、`X-Forwarded-Proto`（hub 自己面向浏览器的 origin；`PENGUIN_TRUST_PROXY=1` 时按其受信代理链读取）与 `X-Forwarded-Prefix: /server/<machineId>`。调用方自带的同名头一律被替换，不会被转发。
- **机器只信自己的 hub：** 机器只在「由数据根签发的会话」（`penguin auth token`，hub 正是以此登录机器）或自身受信代理之后才采信这些头。回调地址变为 `<hub origin>/server/<machineId>/api/projects/<project>/model-oauth/callback?flow=…`。浏览器自己的会话无论带什么头，都使用请求本身的 origin。
- **回调无需会话即可穿过 hub：** `GET /server/<machineId>/api/projects/<project>/model-oauth/callback` 不要求 hub 的会话（桌面端的系统浏览器没有），以不带任何调用方请求头的 GET 转发；机器上的该路由只登记授权码，所有者的轮询仍经需认证的代理。其余代理路径照旧需要会话。
- **API socket 使用页面的主机：** API socket 上的调用改以页面访问的主机与端口发出（受信代理之后采信 `X-Forwarded-*`），不再是裸的 `http://localhost`，经 socket 发起的授权回调因此带上正确的端口。
- **退回手动填写授权码：** 经由未告知浏览器主机的 hub（旧版本）访问机器时，发起授权会以手动模式开启流程并返回 `mode: "manual"`，对话框随之切到一次性授权码输入框并说明原因。从授权页返回数秒后仍未收到结果时，对话框提示改为手动填写授权码。
- 授权对话框从 `models-page.tsx` 移到 `model-oauth-dialog.tsx`。
