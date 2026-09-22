# 端口转发：机器会话上 ssh 自己的 -L 与 -R，双向，按 Workspace 保存

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#804](https://github.com/Prism-Shadow/penguin-harness/pull/804)

[English](2026-09-19-port-forwarding.md)

位于机器上的 Workspace 可以在停靠栏的「端口」面板里把机器的端口带到本服务端（`in`），或把本服务端的端口送到机器上（`out`）。转发就是 ssh 自己的 `-L` 或 `-R`，挂在已持有的那条机器会话上；会被保存，重启与热推送之后仍在。

## 转发

- **一条转发是 `(机器, Workspace, 方向, 远端端口 ⇄ 本地端口)`。** 它属于 Workspace（某台机器上的一个目录），因此该 Workspace 的每个对话看到同一份转发。`in` 把机器的端口放到本地的 `localhost:<本地端口>`；`out` 把本地端口放到机器上的 `localhost:<远端端口>`。位于本服务端的 Workspace 没有转发：它的端口本就在回环上。
- **保存在 `web.db`**（表 `port_forwards`，migration 13 `port-forwards`，swap-safe）。`in` 转发的本地端口缺省取与远端端口同号且本地空闲的端口，否则向上取第一个空闲端口，也可以指定（1024–65535）。`out` 转发须指明送出去的本地服务，机器端口缺省与之同号。
- **由机器的会话承载。** 一台机器的全部转发是它会话的期望集。会话是控制 socket 的 master（`ssh -M -S`），转发以 `ssh -O forward` 加到**正在运行的**会话上、以 `-O cancel` 撤下——不开第二条连接、不重连，绑不上的端口只让这一次请求失败，不影响会话。会话重连后期望集自动重新申请。转发从不拉起 ssh：机器没人用时它等着，并如实报告。
- **Windows hub 上**——Win32 OpenSSH 没有控制 socket——`in` 转发改由本进程自己的 listener 承载，有客户端连上时经会话的 SOCKS 通道拨到机器；`out` 转发被拒绝（`409 unsupported_here`）。
- **状态按层给出，不是一个标志：** `not-connected`（会话未连接）、`pending`（已连，ssh 尚未应答）、`active`（ssh 或 listener 已承载）、`failed` 附 ssh 原话。listener 路径另计当前连接数与上下行字节。

## 持有的会话跨热推送存活

此前持有到机器的 `ssh -T -D` 会话由打开它的那一代平台关闭、由下一代重开——因此每次推送都会断掉经它的每条转发、浏览器拨号与终端中继。现在被持有的会话经资源 registry 交接（`machineSession:<address>`），与 pty 同一方式：下一代按 address 认领同一个 ssh 子进程，再把同一份期望集交给它。临时会话仍随其所属的一代关闭。

## API

- `GET /api/port-forwards?machine=&workspace=`、`POST /api/port-forwards`（`direction` 缺省 `in`）、`DELETE /api/port-forwards/:id`，仅管理员。

## 页面

- **停靠栏新增「端口」面板。** 每条转发画成两个插头之间的一根连线——机器别名与它的端口，「本地」与本地端口——箭头指明字节的去向：`in` 转发从机器出发，`out` 转发从本地出发。连线的颜色即状态（蓝：已承载；灰：等待 ssh 应答；琥珀：机器未连接；红：被拒绝），下方一行用文字说明。表单是同一根连线，端口直接打在插头上；插头之间的箭头是一个按钮，点它两个插头对调——方向就是这样选的。
- **机器卡片新增「端口」按钮**，打开 `/machines/<machineId>/ports`：该机器的全部转发按 Workspace 分组，同一画法，用于排查不通的端口。
