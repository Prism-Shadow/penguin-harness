# The context ring measures against compaction, and ranks files beside tools

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`, `core`
- **PR:** [#584](https://github.com/Prism-Shadow/penguin-harness/pull/584)

[中文版](2026-09-02-context-top-files.zh.md)

The composer's context ring now fills against the point compaction fires rather than the model's
context window, so a context half-way to being summarized reads as half full instead of nearly
empty on a large-window model. Its composition panel also gained a second Top 5: the files whose
`read_file` / `edit_file` / `write_file` traffic occupies the most of the current context, beside
the tool ranking it already had. A Tools / Files switch above the list picks the view, and the
panel remembers the choice for the rest of the tab session.

## The ring fills against the compaction threshold

- The ring, its panel's header ratio and the panel's bar all use one basis: the **effective**
  compaction threshold — `min(the Agent's compaction.max_context_length, the model's
  context_window − the compaction headroom)`, the same derivation the Agent compacts at, with the
  seeded default threshold filled in for an Agent that configures none and the assumed 128000
  window for a model entry that declares none. 64k used against a 128k threshold on a 1M-window
  model now reads 50%, where it read 6% before. Amber past 80% and red past 95% follow the same
  basis.
- The window has not disappeared from view: when it is larger than the threshold, the panel header
  names it under the ratio.
- The bar therefore ends where compaction fires, so the dashed mark that used to say so inside it
  is gone. While the panel is open the server's own `compactionThreshold` is preferred over the
  client's derivation — the same arithmetic, one of them read from disk a moment ago — so an
  Agent-config edit shows up without a page reload.
- Two fallbacks keep the ring honest where no threshold applies: compaction switched off (`<= 0`)
  and the subagent composer, which has no Session-level Agent config to reason from, both keep the
  old window basis.
- The chat page re-reads the Agent's config on an Agent switch and when the tab regains focus, so
  a threshold lowered on the settings page is reflected on the way back.

## A notice when the model cannot hold the Agent's threshold

- The composer raises a dismissible amber notice when the selected model's `context_window` is
  below the Agent's **configured** `compaction.max_context_length` — the case where compaction
  silently fires at the window's edge instead of at the number the user set. It names both
  figures, says to lower the threshold below the window and then run `/compact` once so the new
  threshold takes effect from the next context, and links to that Agent's settings.
- Judged on the configured threshold, never the effective one, which is already capped by the
  window and so could never disagree with it. It re-evaluates when the model changes and when the
  Agent config is re-read; a dismissal is remembered per Session and model for the rest of the tab
  session.

## A new model's context window defaults to 1,000,000

- The Web model dialog records 1,000,000, not 128000, when a custom or user-group model is saved
  with its context-window field blank, and the field's hint says so. A model added by hand is a
  known model, and today's hand-added models are large-window ones; guessing low costs real
  capacity, guessing high costs one edit.
- Core's assumption for an entry that carries **no** `context_window` at all is unchanged at
  128000 — that is the safety default for an unknown window, a different number for a different
  question. `penguin config model add` still writes no default when `--context-window` is omitted.

## Files beside tools in the composition panel

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

## Core

- `DEFAULT_MAX_CONTEXT_LENGTH` moved from `state/default-config.ts` to `llm/context-limits.ts`,
  beside the derivation that caps it, and core gained a `@prismshadow/penguin-core/context-limits`
  subpath. Both halves of the threshold rule now reach a browser bundle through one
  Node-free module, so the web app derives the ring's basis with core's arithmetic instead of a
  second copy of it. The constant is still exported from the package root; nothing that imported
  it needs to change.
