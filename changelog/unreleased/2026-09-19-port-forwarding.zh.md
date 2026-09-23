# 端口转发：机器会话上 ssh 自己的 -L 与 -R，双向，按 Workspace 保存

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#804](https://github.com/Prism-Shadow/penguin-harness/pull/804)

[English](2026-09-19-port-forwarding.md)

位于机器上的 Workspace 可以在停靠栏的「端口」面板里把机器的端口带到本服务端（`in`），或把本服务端的端口送到机器上（`out`）。转发就是 ssh 自己的 `-L` 或 `-R`，挂在已持有的那条机器会话上；会被保存，重启与热推送之后仍在。

## 转发

- **一条转发是 `(机器, Workspace, 方向, 远端端口 ⇄ 本地端口)`。** 它属于 Workspace（某台机器上的一个目录），因此该 Workspace 的每个对话看到同一份转发。`in` 把机器的端口放到本地的 `localhost:<本地端口>`；`out` 把本地端口放到机器上的 `localhost:<远端端口>`。位于本服务端的 Workspace 没有转发：它的端口本就在回环上。
- **保存在 `web.db`**（表 `port_forwards`，migration 15 `port-forwards`，swap-safe；跑过该表早期形态的数据根由 migration 17 带到当前形态——见[向后兼容](2026-09-22-backward-compatibility.zh.md)）。`in` 转发的本地端口缺省取与远端端口同号且本地空闲的端口，否则向上取第一个空闲端口，也可以指定（1024–65535）。`out` 转发须指明送出去的本地服务，机器端口缺省与之同号。
- **由机器的会话承载。** 一台机器的全部转发是它会话的期望集。会话是控制 socket 的 master（`ssh -M -S`），转发以 `ssh -O forward` 加到**正在运行的**会话上、以 `-O cancel` 撤下——不开第二条连接、不重连，绑不上的端口只让这一次请求失败，不影响会话。会话重连后期望集自动重新申请。转发从不拉起 ssh：机器没人用时它等着，并如实报告。
- **Windows hub 上**——Win32 OpenSSH 没有控制 socket——会话改为在启动参数里带上转发：集合变化时用新集合重开会话（经它的通道自行重连），ssh 对绑不上的端口说的话从它的 stderr 读出。两个方向、同样的记录、同样的状态。
- **状态按层给出，不是一个标志：** `not-connected`（会话未连接）、`pending`（已连，ssh 尚未应答）、`active`（ssh 已承载）、`failed` 附 ssh 原话。
- **被 ssh 拒绝的转发会再问**：2 s、5 s、15 s 后各一次，之后以 ssh 的话为准。拒绝多半是会话自己造成的：重开的会话要的正是它所替换的那条会话仍持有的端口——远端 sshd 要看到那条连接结束才释放监听——热推送时新一代平台开的会话与正在关闭的旧会话也是同一情形。重开现在先等旧子进程退出再拉起下一个；重试补上远端尚未释放的那一段。被别的东西占着的端口保持 `failed`，直到期望集变化或会话重连。

## `out` 转发先过审再承载

`out` 转发的监听在机器上，绑在哪里由机器的 sshd 说了算：`-R` 请求的是 `127.0.0.1`，而 `GatewayPorts yes` 的 sshd 会改绑所有网卡、只在 debug 消息里说一句（在 OpenSSH 10 上实测：客户端两种情况都报 success；`no` 与 `clientspecified` 保持本机，且 `no` 之下客户端也放不宽）。因此在把 `out` 转发交给会话之前，服务端先问一次机器——一条探测连接：请求一个由 sshd 自选端口、按 `out` 转发同样的写法绑本机、指向一个关闭端口的监听，趁它在时列出机器的监听，然后结束——并读答案：先看 sshd 自己的「overridden by server GatewayPorts」，再看列表里该端口的地址（`ss`，或 Linux / macOS / Windows 各自写法的 `netstat`）。只有答案是 `loopback` 时才自动承载；`exposes` 与 `unknown`（连不上、没报端口、列表没有工具或没有该端口）一律拒绝：读不出来的机器不当作安全。确定的结论保留十分钟；unknown 下次再问。

- **`POST /api/port-forwards`** 对这样的 `out` 转发答 `409` `forward_exposes` 或 `forward_exposure_unknown`；「端口」面板把它变成一个对话框，说明会发生什么，并提供打开设置的按钮。
- **设置 › 端口**（管理员，服务端全局）逐台列出机器：上次探测的结论、一个「探测」按钮，以及「暴露时仍转发」开关——对这台机器的同意（`GET /api/port-forwards/exposure`、`PUT …/exposure/:machineId {allowed}`、`POST …/exposure/:machineId/probe`；同意存为 `server_settings` 里的一份机器 id 列表）。同意后被扣住的转发立即交给会话；撤回则撤下。
- **记录在案而机器未过审的 `out` 转发**——来自之前的版本，或同意被撤回——被扣住不承载，状态读作 `exposure-refused`（红色，注明两种原因之一），同机器的 `in` 转发照常。结论为 unknown 的，在机器连上之后由面板的轮询再试，最多每三十秒一次。

## 持有的会话跨热推送存活

此前持有到机器的 `ssh -T -D` 会话由打开它的那一代平台关闭、由下一代重开——因此每次推送都会断掉经它的每条转发、浏览器拨号与终端中继。现在被持有的会话经资源 registry 交接（`machineSession:<address>`），与 pty 同一方式：下一代按 address 认领同一个 ssh 子进程，再把同一份期望集交给它。临时会话仍随其所属的一代关闭。registry 分组名带版本（`machineSession.v2`）：被交接的对象运行的是创建它那一代的代码，因此会话行为一变就升级组名，推送时旧组被处置、每台机器用新代码的对象重新 hold 一次。组名守的是行为，结构另有守卫：离任的一代把会话接口的闭合形状（`MachineSession`——每个方法及其背后的每个类型，按接口表打印）注册在会话旁边，接任的一代在认领任何东西之前先与自己的比对。形状不同即判该组出局：其会话在 commit 时关闭，而不是留给一个按另一种方式调用它们的 transport，每台机器重新 hold。

## API

- `GET /api/port-forwards?machine=&workspace=`、`POST /api/port-forwards`（`direction` 缺省 `in`）、`DELETE /api/port-forwards/:id`，仅管理员。

## 页面

- **停靠栏新增「端口」面板。** 每条转发画成两个插头之间的一根连线——机器别名与它的端口，「本地」与本地端口——箭头指明字节的去向：`in` 转发从机器出发，`out` 转发从本地出发。连线的颜色即状态（蓝：已承载；灰：等待 ssh 应答；琥珀：机器未连接；红：被拒绝），下方一行用文字说明。表单是同一根连线，端口直接打在插头上；插头之间的箭头是一个按钮，点它两个插头对调——方向就是这样选的。
- **机器卡片新增「端口」按钮**，打开 `/machines/<machineId>/ports`：该机器的全部转发按 Workspace 分组，同一画法，用于排查不通的端口。
