# Activity runs approve their own tool calls

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `server`, `web`

Every activity run (the stages, spec generation, module assembly, media text, speech and
images) now starts its Session with the **Allow all** approval mode instead of **Always
ask**, so the stages run through without waiting on someone to approve each tool call.
That applies to runs on a Penguin agent and on a coding agent alike.

- The shared WAF checkout stays protected: a write, edit or coding-agent change inside it
  is still refused, whatever the approval mode allows. A shell command is not covered by
  that guard.
- The run's link now reads **Open Session**, and the notes that sent people to its Session
  to answer approvals no longer do.
