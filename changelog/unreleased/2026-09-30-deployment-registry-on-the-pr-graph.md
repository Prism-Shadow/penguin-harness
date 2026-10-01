# A registry of deployments, each placed on the PR graph at the commit it runs

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `server`, `cli`, `web`
- **PR:** [Myriad-Dreamin/penguin-harness#134](https://github.com/Myriad-Dreamin/penguin-harness/pull/134)

[中文版](2026-09-30-deployment-registry-on-the-pr-graph.zh.md)

## Registering a deployment

company-proposals keeps a registry of deployments in its ledger, as `deployment` lines. A deployment is an id; a penguin server deployment also has a `url`. `penguin org proposal deployment add <id> [--url <url>]` (`POST …/proposals/deployments`, `{ id, url? }`) registers one, and anybody in the organization may. `penguin org proposal deployment ls` (`GET …/proposals/deployments`) lists the registry, which holds only what was registered: no server registers itself. A registration is refused with 409 `deployment_registered` when it repeats an id, a normalised url, or the install id the url answers with — the last one catches a registered server behind another address. A url that is not read as a penguin server answers 422 `deployment_unreachable`.

## The commit a deployment runs, on the graph

`GET /api/install` answers `commit` and `describe` beside `installId`: the pushed harness's source revision when a hot update put one on the data root, else the build's own commit. `GET …/proposals/graph` answers a `deployments` array: each registered deployment with its commit and the layer it sits on — the layer whose head it is, or the nearest one it contains, with the commits past it. A server deployment's commit is read from its url; a deployment without a url reports none. A deployment on no layer, or whose commit could not be read, is listed apart with the reason. `penguin org proposal graph` marks each deployment as `@<id> <commit>` at the end of its layer's line, and the web graph page marks the row and lists the rest under the graph.

An older server's `/api/install` has no `commit`; it is shown as not read. A graph answer from a server older than this change has no `deployments`, and the CLI and the page draw it without them.
