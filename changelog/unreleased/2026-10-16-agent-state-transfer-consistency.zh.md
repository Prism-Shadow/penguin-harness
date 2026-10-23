# 导入失败时保留原有 Agent State 与 vault

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1175](https://github.com/Prism-Shadow/penguin-harness/pull/1175)

[English](2026-10-16-agent-state-transfer-consistency.md)

Agent State 导入失败时保留原有 State 与 vault，并拒绝包内链接指向 `agent_state/` 之外的包。

## 细节

- 仅在文件缺失时视为没有 vault：无法读取现行 vault 的导入在替换 State 之前停止。
- 新 State 无法移入、旧 State 又无法移回时，两者都保留在导入暂存目录中，错误信息给出其路径。
- 导入提交后清理暂存目录失败只记录日志，不再让导入失败，导入仍返回其版本号。
- 快照打包失败时清除留在快照目录旁的 `.tmp-` 文件。
- 拒绝 `agent_state/` 不是真实目录、或其中符号链接指向 `agent_state/` 之外或不存在目标的包；`agent_state/` 内的相对链接保留。
