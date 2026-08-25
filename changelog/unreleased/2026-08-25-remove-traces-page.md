# The standalone Trace page is gone; a Trace is read where it was produced

- **Date:** 2026-08-25
- **Type:** change
- **Scope:** `web`, `docs`
- **PR:** [#462](https://github.com/Prism-Shadow/penguin-harness/pull/462)

[中文版](2026-08-25-remove-traces-page.zh.md)

[Keeping one entry point for reading a Trace](2026-08-23-trace-one-entry-point.md) removed the three
in-app links to `/traces` and left the page itself in place, reachable by URL. It is now removed
outright: reading a Trace happens in a conversation's Trace panel, which is the only way in.

## Details

- The `/traces` route and page are deleted, along with the Trace-file tree that only it rendered
  (its lazy per-Agent loading, its Workspace/Agent grouping toggle, and its own group paging).
  An existing `/traces?sessionId=…` link no longer resolves.
- **Importing a Trace moved to System settings → General**, below the CLI-sessions filter — the one
  capability that lived nowhere else. Choose the destination Project and Agent, then pick a `.jsonl`
  file; the pick is the confirmation, and the toast names where it landed.
- Both halves of the destination are picked, where the old dialog asked only for the Agent. The
  endpoint is per-Agent because a Trace file's own `session_meta` cannot name a local Agent — its
  `agent_state` path belongs to the machine that exported it. The Project is asked for because the
  settings dialog does not show which one is open, every other row in it belonging to the account or
  the server; inheriting it silently would land an import in whichever Project the sidebar happened
  to have selected. A Trace can therefore also be imported into a Project other than the open one —
  the conversation list refreshes only when the destination IS the open one, since that is the only
  list on screen.
- Exporting is unchanged and stays with the file it downloads: the Trace panel's export link on the
  selected file.
- The panel itself is untouched — same file view, performance timeline and event list, scoped to the
  open conversation.
- The server's Trace APIs are unchanged, the per-Agent listing endpoint included: it is documented
  surface, and only the Web App's use of it went away.
- `Select` now forwards `aria-label` to its trigger, the way a native select honours one — the
  settings row's Agent picker carries its name there, since the row's own label names the action
  rather than the control.

## Known gap

The landing page's feature grid still shows a capture of the removed page. The copy describes the
capability, which the Trace panel still provides; the screenshot is re-captured at release time.
