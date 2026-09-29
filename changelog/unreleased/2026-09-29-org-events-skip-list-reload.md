# An organization's runs no longer reload the Sessions list

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`, `server`

[中文版](2026-09-29-org-events-skip-list-reload.zh.md)

The Sessions list shows only the user's own conversations: every fetch asks with `excludeOrg=1`. Even so, each desk or ticket run of an organization reloaded the whole list twice, once for `org_run` and once for its `session_created`, and each reload asked every source about every Agent. The reloads could never bring in a new row. With an organization busy and a machine slow to answer, they piled up in the browser (`net::ERR_INSUFFICIENT_RESOURCES`). Now an organization's runs leave the list alone.

## Details

- `org_run` still reaches the company store and any open organization page, but it no longer reloads the Sessions list.
- `session_created` carries `client: "org"` for a Session an organization opened: a desk or ticket Session, or a subagent of one. The field is absent otherwise. The list skips the reload for such an event, and so does an open conversation for such a child. An event from a server that predates the field still reloads, as before.
