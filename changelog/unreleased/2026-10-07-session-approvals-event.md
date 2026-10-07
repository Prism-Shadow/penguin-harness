# A Session waiting for approval is marked live in every list

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-10-07-session-approvals-event.zh.md)

A sidebar row's approvals mark came only from the last list fetch, so a Session that started
waiting for a tool approval while another conversation was open showed nothing until the list was
loaded again. The user channel gained a `session_approvals` event with the Session's count of
waiting calls, and the Web App applied it to the row as it arrived. Any client watching a
Project's Sessions over `GET /api/events` could tell which one waits for a person without
subscribing to every Session's stream.

## Details

- `session_approvals` carried `sessionId` and `count`, the row's `pendingApprovalCount` as it
  stood after the change, zeros included. It was published when a call was escalated to a person,
  when a call was answered, and when an interrupt or a Task boundary denied the waiting calls;
  an interrupt that denied several calls published one event. Its audience was the same as for
  `session_state`.
- A call the approval mode answered by itself (`allow-all`, `deny-all`, read-only tools under
  `read-only`) and a call an unattended Session denied on the spot published nothing.
- The calls themselves stayed on the Session's own stream as `approval_request`, replayed on
  subscribe.
- The Server API page listed the event and when it fires, in both languages.
