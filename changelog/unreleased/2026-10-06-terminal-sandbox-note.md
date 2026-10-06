# Terminals say they are outside the sandbox

- **Date:** 2026-10-06
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-06-terminal-sandbox-note.zh.md)

A shown terminal, in the dock and on the standalone `/terminal` page, carries a "Not sandboxed" label with a "?" beside it. The explanation says the terminal is the person's own shell, running as the account it was opened under, and that a Session's permissions (such as Workspace write) and the sandbox confine only the agent's commands and hook scripts. The terminal's behaviour is unchanged: it was never confined by a Session's policy, and the Session page showed that policy next to it without saying so.
