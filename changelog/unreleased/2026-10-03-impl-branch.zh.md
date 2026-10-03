# 提案的实现登记为一对分支，PR 变为可选

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `cli`, `web`

[English](2026-10-03-impl-branch.md)

提案的实现原先登记为一张 impl PR，现在改为一条 impl branch：head 与衡量它的 base，各是一对 `<remote, branch>`；remote 是提案仓库里指向 GitHub 的 git remote，或直接写出的 `owner/repo`。base 不再默认为 `dev`。patch 是 base 与 head 的 merge-base 到 head 的差异。PR 变为可选，之后挂到这条分支上；登记一张 PR 等于登记它的 head 与 base。此前写下的账本行如何读取，见[向后兼容](2026-10-03-backward-compatibility-impl-branch.zh.md)。

## 登记与读取

- `PUT …/proposals/:number/impl` 接受 `{ head, base }`、`{ url }` 或三者同时。remote 解析不出 GitHub 仓库时 400 `impl_remote_unknown`；head 已是别的提案的实现时 409 `impl_branch_taken`；PR 的 head 与声明的 head 不符时 409 `impl_pr_mismatch`。挂到已声明 head 上的 PR 以自己的 base 取代声明的 base。
- `GET …/proposals/:number/impl/diff` 以 `ProposalImplDiff` 返回 patch：解析后的两侧、head 与 merge-base 的提交、ahead 与 behind、逐文件的增删行数与 hunk，以及 GitHub 上的比较链接。尚未登记时 409 `no_impl`，读不到 GitHub 时 502。
- `ProposalItem` 新增 `impl`（`head`、`base`、`pr`、`by`、`at`）；`implPr` 保留为这条分支上的 PR。

## 关系图、部署与合并

- 在 PR 关系图上，没有 PR 的 impl branch 认领交付仓库上 head 分支与它同名的 open PR；认领不到的以新原因 `no-pr` 列出。`ProposalGraphUnplaced.implPr` 变为可空，并新增 `branch`。
- 对有声明 head 的提案执行 `deploy` 时，部署该分支此刻的 tip。`ProposalDeployPlan.pr` 与 `prUrl` 变为可空；没有 PR 时 `PENGUIN_DEPLOY_PR` 与 `PENGUIN_DEPLOY_PR_URL` 为空串。没有实现的提案返回 409 `no_impl`（原为 `no_impl_pr`）。
- 报告 `merged` 仍以 PR 的合并为凭据，因此只有分支的实现须先挂上 PR。

## CLI 与 Web App

- `penguin org proposal impl <n> [url] [--head <remote> <branch> --base <remote> <branch>]` 登记分支对、PR 或两者；`--head` 与 `--base` 须同时出现，各取两个值。`show` 打印 `Impl branch: <head> ← <base>` 及其 PR。新增 `penguin org proposal diff <n> [--stat]`，打印 patch 或逐文件统计。`deploy` 对没有 PR 的目标写作 `<repo>:<branch>`。
- 提案页新增「实现」一节：head ← base、PR 或「尚未开 PR」，以及按需展开的改动文件、增删统计与 GitHub 比较链接。PR 关系图的未落位列表对没有 PR 的实现显示其分支。
