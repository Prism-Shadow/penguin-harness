# 机器重连有明确的放弃点并提供「重试」；UI 包统一的重试状态

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `docs`
- **PR:** [#1204](https://github.com/Prism-Shadow/penguin-harness/pull/1204)

[English](2026-10-18-reconnect-retry.md)

服务端保持连接的机器此前会被无限重试，退避到封顶后每 5 分钟一次，机器管理页既不说下次何时尝试，也不能立即再试。现在连续失败 8 次（约 15 分钟）后停止自动重连，遇到重试也不会好转的 ssh 失败则第一次即停止；机器卡片与详情弹窗显示这一轮进行到哪里，并提供「重试」。重试状态是共享 UI 包里的一个组件，对话的重连提示行也从中取倒计时与按钮。

## 服务端

- 重连连续失败 8 次即停止这一轮（`reconnect.gaveUp: "attempts"`，`nextAt: null`），每分钟一次的看护循环不再尝试已停止的机器。本服务端重启后每一轮都重新开始。
- 重试也不会好转的 ssh 失败——主机密钥未知或已变、私钥文件不可用、密钥被拒、ssh 配置有误——第一次失败即停止（`gaveUp: "ssh"`），不运行连接检查。
- `MachineReconnect` 新增 `maxAttempts` 与 `gaveUp`。
- `POST /api/projects/:projectId/machines/:machineId/reconnect` 立即发起一次尝试：等待中的跳过剩余等待、次数不变，已停止的从第 1 次重新开始，正在尝试或已连接时什么都不做。答复机器列表，或 `409` `job_running`、`password_refused`、`not_kept_connected`，或 `404` `unknown_machine`。

## 机器管理页

- 卡片中段与详情弹窗的「重新连接」分节显示重试状态：「正在尝试第 4/8 次重连…」；「第 3/8 次重连失败 · 80 秒后重连」与「立即重试」；「8 次重连都没连上，已停止自动重试」、上次失败的原因与「重试」；重试也不会好转的 ssh 失败写明办法并带「重试」；密码被拒写明办法、不带「重试」。倒计时逐秒刷新。
- 状态胶囊新增「重连已停止」（attention），密码被拒仍为「登录被拒」。卡片不再写这一轮已持续多久，详情弹窗里仍有。
- 自动重连已停止时，新建对话的 Agent 选择与 Agent 设置写明「那台机器的自动重连已停止——请在「机器管理」页面重试」。
- 「重试」被拒时，页面提示区以界面语言说明原因，按钮可以再按。

## UI 包与组件画廊

- 新增 `RetryStatus`（`trying`、`waiting`、`gaveUp`、`blocked` 四个阶段，卡片用的 `line` 与弹窗用的 `block` 两种排布）、`RetryActions`（按钮组：按下后两个按钮都置灰，直到下一次尝试开始；请求被拒即恢复）、`useCountdown` 与 `countdownSeconds`。`MachineCard` 的中段可放 `retry` 状态，`MachineStatusPill` 新增 `reconnectStopped`。
- 对话的重连提示行改用它们的倒计时与「立即重试」「放弃」按钮，提示内容与行为不变。
- 组件画廊新增「重试」主题：两种排布下的每个阶段、机器卡片中、对话提示行中与手机宽度；「机器」主题新增一张重连已停止的卡片。
