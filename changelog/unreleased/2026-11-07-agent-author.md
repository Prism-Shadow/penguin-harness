# Agents carry an author, and the Agents page groups by it

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `web`, `skills`
- **PR:** [#1508](https://github.com/Prism-Shadow/penguin-harness/pull/1508)

[中文版](2026-11-07-agent-author.zh.md)

Every Agent now records who created it in a top-level `author` key in `system_config.yaml`, next to `name` and `description`. The value is `user` (a person in the Web App), `agent` (an agent, inside a conversation) or `company` (company mode). A missing or unknown value reads as `user`. The Agents page groups its list by author.

## Creation paths

- The Web App's **Create agent** dialog sends `author: user`.
- `POST /api/projects/:projectId/agents` takes `author`, which defaults to `user`. Any other value is refused with 400 before anything is created.
- `penguin agent create` gained `--author <user|agent|company>`. Without the flag it sends `agent` when it runs inside a conversation (`PENGUIN_SESSION_ID` is set), and sends nothing otherwise, which the server records as `user`. An unknown value exits 1 before any request.
- Company mode writes `company` for the CEO of a new organization and for a hire it creates. Hiring an existing Agent keeps that Agent's author.
- The `agent-initialization` skill, which **Create with AI** runs, writes `author: agent` into the Agent it creates and checks for it when it validates. The fixed instructions of the **Create with AI** dialog ask for the same.
- An imported Agent keeps the `author` its package carries. The `agent-porting` skill, which migrates an agent from another coding tool in a chat, writes `author: agent` into the package it imports.

## Reading and editing

- The Agent list (`AgentSummary.author`) and the config view (`AgentConfigDto.author`) carry the effective author. `PUT …/config` writes `author` in place with comments kept, and puts a new key right after `description`, or after `name` when the file has no description. **Restore default configuration** and the kernel update both keep it.
- The **Overview** tab of Agent settings has an **Author** select (**User**, **Agent**, **Company mode**). It is part of the overview form, so **Save** writes it and **Reset** puts it back.

## The Agents page

- The header has a grouping select after the search box: **Group by author** (the default) or **No grouping**. The browser remembers the choice.
- By author, the list shows **Created by users**, **Created by agents** and **Created in company mode** in that order, and leaves out a group with no Agents. Each group header folds like the Plugins page's, the browser remembers which groups are folded, and a search opens every group it leaves. Cards inside a group have no frame of their own, and an organization employee sits in its author's group, still showing its organization, instead of a separate **Company employees** section.
- **No grouping** is the list as before: one column, with the employees in their own section at the end.
- Pickers and the sidebar are unchanged.

## Existing Agents

Organization employees made before this change are stamped `company` once. See [backward compatibility](2026-11-07-backward-compatibility.md).
