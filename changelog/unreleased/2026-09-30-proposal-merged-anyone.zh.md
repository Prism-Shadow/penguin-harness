# impl PR 在 GitHub 上读作已合并后，员工即可报告提案 merged

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#126](https://github.com/Myriad-Dreamin/penguin-harness/pull/126)

[English](2026-09-30-proposal-merged-anyone.md)

`penguin org proposal merged <n>`（`POST …/proposals/:number/merged`）不再对非实现者的员工回 403 `not_implementer`。先查状态（非 `approved` 回 409 `proposal_status`）；人与实现者照旧凭自己的话报告；组织内其他员工改凭 GitHub 的事实：当场向 GitHub 读该提案的 impl PR（`penguin org proposal impl`，不走页面那一分钟的缓存），须已合入其仓库的默认分支。没有 impl PR 回 409 `impl_pr_missing`；impl PR 仍 open、已关闭、合进了别的分支或读不到，回 409 `impl_pr_not_merged`，并在消息里说明是哪一种。`status` 行照旧记下是谁报告的（`by`）。

没人实现的提案获批时，发给作者的通知不再让它去跑一句它无权执行的命令：通知里写明 impl PR（或如何登记），并说明合入默认分支后再跑 `merged`。
