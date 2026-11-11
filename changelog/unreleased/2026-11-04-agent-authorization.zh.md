# 有风险的动作要等人同意：提示词的 `# Tool use` 新增征得同意的规则，命令策略新增 `ask` 规则

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui`, `docs`
- **PR:** [#1490](https://github.com/Prism-Shadow/penguin-harness/pull/1490)

[English](2026-11-04-agent-authorization.md)

Agent 不再自作主张地合并 PR、发布包或强推。这由两层共同承担：每个 Agent 都会读到的一条默认系统提示词规则，以及即使在 `allow-all` 下也能拦住其中最常见命令的命令策略规则。

## `# Tool use` 中征得同意的规则

默认系统提示词的 `# Tool use` 小节新增一条规则：

- 难以撤销或作用到本机之外的动作（合并或关闭 PR、推送默认分支或强推、发布 Release、发布包、删除用户的东西），要先在本对话中得到用户同意，用户已在 `AGENTS.md`、记忆或任务本身中持久授权的除外。
- 同意只对给出时的那一步有效，来自其他对话或压缩摘要的同意不会延续。
- 销毁任何东西之前先查看。

内核版本升至 `2026-11-09`（提示词页签）。已有 Agent 在 Agents 页经内核更新采纳这条规则；更新后，每个运行中的对话会在下一次轮换时重新读取一次提示词前缀。

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

出厂规则的正则在 Node 22 及更早的引擎上也能编译：大小写不敏感的单词改写为逐字母的字符类，不再用 ES2025 的内联修饰符 `(?i:…)`。已存规则的匹配式在服务端的运行时上编译不过时，匹配命令时跳过该规则，按规则与匹配式各记一次日志，并在安全策略页连同原因标出；已存的规则保持原样。服务端与 CLI 在低于 24 的 Node 上启动即退出，并说出检测到的版本。规则列表改为列对齐的分页表格（每页十条，分页器与「保存」固定在表格下方），服务端因某条匹配式拒绝保存时，表格转到该规则所在页并标出这一行。

## SDK

`ApproveFn` 新增可选的第二个参数 `context?: { reason?: ApprovalReason }`。`Session.run` 的策略包装在 `ask` 命中时以 `{ reason: { kind: "policy", rule } }` 调用宿主的回调，其余调用只传调用本身；引擎从不读取这个原因。收到原因的宿主无论审批模式都把调用交给人决定。按单参数签名写的回调照样能通过编译，只是会像对待其他调用一样决定 `ask` 命中。Subagent 的原因经由它继承的回调传递，`Session.setSubagentApprovalFallback` 现在也会用命令策略包住兜底审批出口。服务端为这样的调用推送的 `approval_request` 事件附带同一个 `reason`，`approval_decision` 记录不变。
