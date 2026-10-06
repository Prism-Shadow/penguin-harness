# 终端标明自己不受沙盒约束

- **Date:** 2026-10-06
- **Type:** fix
- **Scope:** `web`

[English](2026-10-06-terminal-sandbox-note.md)

显示中的终端（Dock 内与独立的 `/terminal` 页面）带有「不受沙盒约束」标签，旁边附一个「?」。说明写明：终端是使用者自己的 Shell，以打开它的账户身份运行；Session 的权限（如「仅工作区可写」）与沙盒只约束 Agent 执行的命令和 Hook 脚本。终端本身的行为不变：它从未受 Session 策略约束，此前 Session 页把该策略摆在终端旁边却没有说明这一点。
