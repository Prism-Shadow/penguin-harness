# Company mode: an organization can live on another machine

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-19-company-mode-remote-machines.zh.md)

An organization is files and desks — its chart, handbook, tickets and channels are written by the server whose filesystem holds its shared workspace, and its employees' Sessions run there. Until now every company-mode call went to the server the window is on, so an organization could only ever be created and worked with locally: the create dialog did not offer a machine, and a workspace on one could not be chosen. An organization can now be created on any machine the Project holds a connection to, and is then used from the same window like a local one.

## Creating

The create dialog gains **Runs on** — *This server*, or one of the Project's held machines, shown as `SSH: <alias>` — and is absent for a Project that reaches no machine. The rest of the form follows it: the workspace browser lists that machine's directories, the model picker that machine's models (model config is per server), and the generated id is proposed by that machine's server. Changing the machine clears the model and the workspace, which were the other machine's. The draft kept across an accidental close remembers the machine with the path. A machine whose company mode is switched off says so; an id another machine of the Project already uses is refused before that machine is asked.

## Using

The organization list is the merge of this server's organizations and those of every held machine; a machine with company mode off counts as "none there", one that cannot be reached marks the list partial rather than its organizations deleted. The switcher names a remote organization `Name [SSH: alias]`, the way a Workspace on a machine is named. Where two machines hold the same id, this server's is the one listed.

Every organization-scoped call — the forty under `/api/projects/<p>/organizations/<orgId>/…` — goes to the machine that organization was last listed on, by the same path rule Sessions already use, so none of the pages names a machine. Sessions an organization's answers name (a desk, a ticket's work Session, the CEO desk a new organization opens onto) are recorded against the same machine, which is what makes opening one reach the right server. Hiring offers the Agents of the organization's machine, since an Agent is per server, and the settings dialog browses and lists models on it. Company events already arrived over each held machine's event stream.
