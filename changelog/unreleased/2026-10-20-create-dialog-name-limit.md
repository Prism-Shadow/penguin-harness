# The create dialogs say a name past its limit under the name field

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-20-create-dialog-name-limit.zh.md)

The "New Project", "Create Agent" and "New organization" dialogs accepted a name of any length and sent it as typed. The server refused names over 100 characters with an English message — drawn under the id field in the first two, on the retry line in the third — while the name field itself said nothing, and the person learned the ceiling only after submitting. All three now state the limit under the name field — the Project and Agent dialogs as the value is typed, the organization dialog on Create, each the way its own fields teach their rules — and nothing is sent until the name fits, so no server round trip is needed. A name within the limit creates exactly as before.

## Details

- The ceiling, 100, is the same number the server enforces on all three create routes and the Project settings rename caps its input at; it is spelled once in `packages/web/src/lib/name-limits.ts`, and the dialogs measure the trimmed value — what they send.
- The message is part of both dictionaries (「显示名最多 100 个字符」 for the Project's and the organization's display name, 「名称最多 100 个字符」 for the Agent's name), with the English side alongside.
