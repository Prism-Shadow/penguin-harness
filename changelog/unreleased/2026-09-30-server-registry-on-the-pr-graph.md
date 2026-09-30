# A registry of penguin servers, each placed on the PR graph at the commit it runs

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `server`, `cli`, `web`
- **PR:** [Myriad-Dreamin/penguin-harness#134](https://github.com/Myriad-Dreamin/penguin-harness/pull/134)

[中文版](2026-09-30-server-registry-on-the-pr-graph.zh.md)

## Registering a server

company-proposals keeps a registry of penguin servers in its ledger, as `server` lines. `penguin org proposal server add <name> <url>` (`POST …/proposals/servers`) registers one, and anybody in the organization may. `penguin org proposal server ls` (`GET …/proposals/servers`) lists the registry. The server answering the request is always first, as `this`, and is never registered. A registration is refused with 409 `server_registered` when it repeats a name, a normalised address, or the install id the address answers with — the last one catches the answering server itself, or a registered one, behind another address. An address that is not read as a penguin server answers 422 `server_unreachable`.

## The commit a server runs, on the graph

`GET /api/install` answers `commit` and `describe` beside `installId`: the pushed harness's source revision when a hot update put one on the data root, else the build's own commit. `GET …/proposals/graph` answers a `servers` array: each registered server with its commit and the layer it sits on — the layer whose head it is, or the nearest one it contains, with the commits past it. A server on no layer, or whose commit could not be read, is listed apart with the reason. `penguin org proposal graph` marks each server as `@<name> <commit>` at the end of its layer's line, and the web graph page marks the row and lists the rest under the graph.

An older server's `/api/install` has no `commit`; it is shown as not read. A graph answer from a server older than this change has no `servers`, and the CLI and the page draw it without them.
