# Truncated text shows its whole value on hover

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#1069](https://github.com/Prism-Shadow/penguin-harness/pull/1069)

[中文版](2026-10-12-truncated-text-hover.zh.md)

A line cut off with an ellipsis, a path shortened to its last segments and a workspace named by
its folder could hide their whole value with no way to read it. Hovering or focusing them now
shows it.

## Details

- **Any ellipsized line.** The shared tooltip layer shows the whole text of a line shortened with
  an ellipsis or a line clamp whenever that line is actually cut off and nothing around it carries
  a hint of its own: memory paths and descriptions in the memory panel, Agent group names in the
  sidebar, and every other such line, without a hint written for each. A monospace line shows in
  the code panel. Resting on a row picks its first cut-off line. Sidebar conversation titles that
  scroll their tail into view on hover, and anything wrapped in a `<Tooltip>`, keep their own
  behaviour.
- **Workspace groups.** The full path behind a workspace group's folder name shows on hover in the
  sidebar and on the Archived chats page, also when the name fits. The hint was there but was
  hidden by the rule that drops hints repeating visible text.
- **Tool calls.** A file tool's subtitle, shortened to `…/parent/file`, shows the whole path on
  hover.
