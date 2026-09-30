# penguin server 名单，每台按它所跑的 commit 标在 PR 关系图上

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `server`, `cli`, `web`
- **PR:** [Myriad-Dreamin/penguin-harness#134](https://github.com/Myriad-Dreamin/penguin-harness/pull/134)

[English](2026-09-30-server-registry-on-the-pr-graph.md)

## 登记 server

company-proposals 在账本里以 `server` 行记一份 penguin server 名单。`penguin org proposal server add <name> <url>`（`POST …/proposals/servers`）登记一台，组织内任何人都可以登记；`penguin org proposal server ls`（`GET …/proposals/servers`）列出名单。应答请求的这台 server 始终在首位，名为 `this`，不需要登记。名字重复、规范化后的地址重复、或该地址回的 installId 与已有一台相同，都回 409 `server_registered`——最后一条认得出换了地址的本机或已登记的 server。读不成 penguin server 的地址回 422 `server_unreachable`。

## 关系图上的 commit

`GET /api/install` 在 `installId` 之外多回 `commit` 与 `describe`：数据根上有热更新推来的 harness 时取它记录的来源 revision，否则取构建本身的 commit。`GET …/proposals/graph` 多回 `servers` 数组：每台已登记的 server、它的 commit 和所在层——commit 等于哪一层的 head 就在哪一层，否则在它包含的最近一层，并写出多出的提交数。不落在任何一层、或读不到 commit 的 server 单列并写明原因。`penguin org proposal graph` 在对应层那一行的行尾写 `@<name> <commit>`，Web 关系图页在对应行上加标记，其余列在图下。

较旧的 server 的 `/api/install` 没有 `commit`，显示为读不到。本改动之前的 server 回的关系图没有 `servers`，CLI 与页面照常画图，只是不带 server 标记。
