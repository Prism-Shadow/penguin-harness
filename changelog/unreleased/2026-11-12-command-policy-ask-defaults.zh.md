# 出厂命令策略规则一律需确认

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `core`, `docs`, `skills`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)
- **Breaking:** yes — 命中出厂规则的命令改为等人确认，不再直接拒绝

[English](2026-11-12-command-policy-ask-defaults.md)

把原本直接拒绝的九条出厂命令策略规则（`rm-recursive-force`、`mkfs`、`dd-to-block-device`、`fork-bomb`、`overwrite-block-device` 及四条 Windows 对应规则）由 `deny` 改为 `ask`，出厂规则因此全部把命中的命令交给人决定，与审批模式无关。Project 仍可在安全策略页把任一条规则改为拒绝。

## 细节

- 新建 Project 预置的、**恢复默认** 载入的，都是全部为 `ask` 的规则集；`.project_config.toml` 里没有 `[command_policy]` 规则列表的 Project 也按它运作。
- 已存储规则列表的存量 Project 保持原样，其中的 `deny` 规则不变，直到有人点 **恢复默认** 并保存。
- `deny-all` 下命中 `ask` 规则仍然拒绝，组织的无人值守 Session 当场拒绝。
- 更新了配置、Web App 与服务端 API 文档，以及 `agent-evaluation` Skill 中的 Harbor 指引。

## 兼容性

- 审批回调不读 `context.reason` 的 SDK 宿主（只按审批模式作答的单参数回调）会像对待其他调用一样决定出厂规则的命中，全部放行的回调因此会放过 `rm -rf`。要保留拒绝，传入带 `deny` 规则的 `commandPolicy`，或把带策略原因的调用交给人决定。
