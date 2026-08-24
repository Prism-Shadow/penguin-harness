# Pick the Skills a new Agent starts with

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `web`, `server`

[中文版](2026-08-23-agent-create-skills.zh.md)

The Agent create dialog gained a Skills field: a dropdown that takes several skills from the
library at once, and creating the Agent installs them into it.

## Details

- The field uses the form-variant picker trigger already shared by the schedule dialog's model and
  workspace pickers, over the same multi-select panel the chat composer's skills dropdown uses — a
  search box and one toggle row per library skill, the panel staying open as rows are toggled.
- That panel gained a bulk row, shown where a host asks for it: the running count of what is
  picked, plus **Select all** and **Select none**. Both act on the rows the search box currently
  leaves visible, so a filtered "select all" adds only the matches.
- `POST /api/projects/:p/agents` accepts a `skills` array of library skill names. The names are
  resolved against the library before the Agent directory exists — an unknown name answers 404
  `unknown_skill` and creates nothing — and are installed through the same writer the Skills tab's
  install uses, inside the same cleanup window as the rest of Agent initialization.
- Creating an Agent with nothing picked installs no skills, as before.
