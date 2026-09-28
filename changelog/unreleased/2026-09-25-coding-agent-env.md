# Coding agents take their own environment variables

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `coding-agents`, `server`, `web`

Each agent on **Models → Local CLI** has an **Environment** section where an admin adds the
variables it starts with, such as `GEMINI_API_KEY` or `COPILOT_GITHUB_TOKEN`. It works for
detected agents as well as ones added by hand. Values stay on the server and are shown
masked; members do not see them. Names Penguin sets itself (`PATH`, `HOME`, `PENGUIN_*`
and the like) are refused.

A change applies from the agent's next start; while its sessions run, the card says so.
Saving an agent again from **Add agent** no longer erases its variables, and the dialog's
plain-text environment box is gone in favour of the card's editor.
