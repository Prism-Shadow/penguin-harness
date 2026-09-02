# The context ring's panel ranks files beside tools

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#584](https://github.com/Prism-Shadow/penguin-harness/pull/584)

[中文版](2026-09-02-context-top-files.zh.md)

The context ring's composition panel gained a second Top 5: the files whose `read_file` /
`edit_file` / `write_file` traffic occupies the most of the current context, beside the tool
ranking it already had. A Tools / Files switch above the list picks the view, and the panel
remembers the choice for the rest of the tab session.

## Details

- `GET /api/sessions/:sessionId/context` gained `topFiles`: at most five entries of
  `{ path, tokens, ops: { read, edit, write } }`, ranked by the context each file's file-tool calls
  and their results occupy — the same character heuristic and the same call-to-result pairing as
  `topTools`, so both rankings are shares of the same estimate. A call is keyed by the file its
  `file_path` resolves to, the way the file tools resolve it against the Workspace, so `a.ts`,
  `./a.ts` and the absolute spelling are one row. A call with a missing or invalid `file_path` is
  left out of the file ranking (the tool itself refuses such a call); it still counts as tool
  traffic.
- A file inside the Session's Workspace is shown Workspace-relative; any other file is absolute,
  with the home directory shortened to `~`.
- The Files view shows each file's name in bold with its directory muted and the full path on
  hover, then how many reads, edits and writes named it, drawn with the file, pencil and page-plus
  glyphs the file summary and memory-changes cards already use. Its token and percent columns are
  the same shares of the whole context the Tools view shows. A context whose tools never touched a
  file says "No file traffic in this context".
- The six parts, `contextClosed` and `compactionThreshold` are unchanged.
