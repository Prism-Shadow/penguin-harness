# 部署名单，每个部署按它所跑的 commit 标在 PR 关系图上

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `server`, `cli`, `web`
- **PR:** [Myriad-Dreamin/penguin-harness#134](https://github.com/Myriad-Dreamin/penguin-harness/pull/134)

[English](2026-09-30-deployment-registry-on-the-pr-graph.md)

## 登记部署

company-proposals 在账本里以 `deployment` 行记一份部署（Deployment）名单。一个部署就是一个 id；penguin server 部署另有一个 `url`。`penguin org proposal deployment add <id> [--url <url>]`（`POST …/proposals/deployments`，`{ id, url? }`）登记一个，组织内任何人都可以登记；`penguin org proposal deployment ls`（`GET …/proposals/deployments`）列出名单；名单上只有登记过的部署，没有哪台 server 自动登记自己。id 重复、规范化后的 url 重复、或该 url 回的 installId 与已有一个相同，都回 409 `deployment_registered`——最后一条认得出换了地址的已登记 server。读不成 penguin server 的 url 回 422 `deployment_unreachable`。

## 关系图上的 commit

`GET /api/install` 在 `installId` 之外多回 `commit` 与 `describe`：数据根上有热更新推来的 harness 时取它记录的来源 revision，否则取构建本身的 commit。`GET …/proposals/graph` 多回 `deployments` 数组：每个已登记的部署、它的 commit 和所在层——commit 等于哪一层的 head 就在哪一层，否则在它包含的最近一层，并写出多出的提交数。server 部署的 commit 从它的 url 读；没有 url 的部署不报 commit。不落在任何一层、或读不到 commit 的部署单列并写明原因。`penguin org proposal graph` 在对应层那一行的行尾写 `@<id> <commit>`，Web 关系图页在对应行上加标记，其余列在图下。

较旧的 server 的 `/api/install` 没有 `commit`，显示为读不到。本改动之前的 server 回的关系图没有 `deployments`，CLI 与页面照常画图，只是不带部署标记。
