# 有风险的动作要等人同意：提示词新增 `# Authorization` 小节，命令策略新增 `ask` 规则

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui`, `docs`

[English](2026-11-04-agent-authorization.md)

Agent 不再自作主张地合并 PR、发布包或强推。这由两层共同承担：每个 Agent 都会读到的一段默认系统提示词，以及即使在 `allow-all` 下也能拦住其中最常见命令的命令策略规则。

## 提示词的 `# Authorization` 小节

默认系统提示词在 `# Constraints` 与 `# Output` 之间新增 `# Authorization`，要求模型做到四点：

- 难以撤销或作用到本机之外的动作，先在本对话中得到用户的明示同意，用户已持久授权的除外（写在 `AGENTS.md`、记忆或任务本身中）。小节列出了这一类动作：合并、关闭或批准 PR；推送默认或受保护分支、强推、删除分支或标签；删改 Workspace 与 scratchpad 之外的内容；发布、创建 Release、部署；向外部服务发消息；花钱；修改权限或凭据。
- 同意只对给出时的那一步有效。此前、其他对话、相似步骤中给出的同意，或只记在压缩摘要里的同意，都不算数。
- 销毁或覆盖之前先查看目标，并说明会失去什么。
- 如实汇报每个在 Workspace 之外生效的动作，包括失败与只完成一部分的。

内核版本升至 `2026-11-04`（提示词页签）。已有 Agent 在 Agents 页经内核更新采纳这一小节；更新后，每个运行中的对话会在下一次轮换时重新读取一次提示词前缀。

## 命令策略的 `ask` 规则

命令策略的规则新增 `action`：`deny`（缺省，与此前相同）拒绝命中的调用，`ask` 则在 `deny-all` 以外的所有审批模式下把调用交给人决定。Web App 把这样的调用显示为普通的审批卡片，并以一行弱化文字写明是哪条规则要求确认。无论在列表里的先后，`deny` 命中都优先于 `ask` 命中。组织的无人值守 Session 遇到 `ask` 命中会当场拒绝，pre-tool-use 钩子的 `allow` 越不过它，Subagent 里的命中会交给同一个人。

新建的 Project 在九条 `deny` 规则之后预置五条出厂 `ask` 规则：

| 规则 | 匹配 |
| --- | --- |
| `gh-pr-merge-close` | `gh pr merge`、`gh pr close` |
| `gh-release` | `gh release create`、`delete`、`edit` |
| `git-push-force` | 带 `-f`、`--force` 或 `--force-with-lease` 的 `git push` |
| `git-push-default-branch` | 推到 `main` 或 `master` 的 `git push` |
| `package-publish` | `npm publish`、`pnpm publish`、`yarn publish` |

已经存储了规则列表的 Project 保持原样，可在 Project 设置的安全策略页点「恢复默认」采纳这五条规则，保存后会替换整张列表。从未保存过规则列表的 Project 本就按出厂规则集运作，已经包含它们。

规则编辑器新增「拒绝 / 需确认」选项，`ask` 规则的列表行带一个「需确认」标签。`.project_config.toml` 在这样的规则上存储 `action = "ask"`。

## SDK

`RunOptions.askHuman`（类型 `AskHumanFn`，即另外收到规则名的 `ApproveFn`）是宿主为 `ask` 命中提供的、通向人的审批路径；不提供时由 `approve` 决定。`Session.setSubagentApprovalFallback(approve, askHuman?)` 现在会用命令策略包住兜底审批出口。服务端为这样的调用推送的 `approval_request` 事件附带 `reason: { kind: "policy", rule }`，`approval_decision` 记录不变。
