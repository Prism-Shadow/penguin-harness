# Organizations: a channel message whose session cannot be placed is refused

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`
- **PR:** pending

[中文版](2026-09-28-unknown-channel-session.zh.md)

`POST …/organizations/:orgId/channels/:channelId/messages` sent with the control environment's API token and a `sessionId` that names no session of one of the organization's employees now answers 400 `unknown_session` and writes nothing. It used to record the line under the token holder's own name at hop 0 — a message meant to come from an employee showed up as a person's, and was delivered however long the chain behind it.

## Details

- The id is refused when the server has no such session, when the session belongs to another Project, or when its Agent is not an employee of this organization.
- Unchanged: a message without `sessionId` is the caller's own; over a signed-in cookie the field is still dropped, so the Web App's messages are the person's; `tickets/:id/attach` still reads the field as the session to attach.
