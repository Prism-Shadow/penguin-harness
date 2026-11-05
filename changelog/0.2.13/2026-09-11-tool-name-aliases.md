# Tool cards name the built-in tools by a short alias

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `web`
- **PR:** [#688](https://github.com/Prism-Shadow/penguin-harness/pull/688)

[中文版](2026-09-11-tool-name-aliases.zh.md)

A tool-call card in a conversation now names each of the seven built-in tools by a short alias
instead of the name the model calls it by: `read_file` reads as "read", `write_file` as "write",
`edit_file` as "edit", `exec_command` as "exec", `input_command` as "follow", `run_subagent` as
"subagent" and `input_subagent` as "communicate", with the Chinese dictionary carrying its own
wording. Appearance settings gained a "Tool short names" switch, on by default, that turns the
aliases off.

## Details

- The alias appears in the two places the card spells a tool name: the collapsed row's header and
  the pending-approval block's name pill. Both keep the tool's own name in their tooltip whenever
  an alias is shown.
- Only the built-in tools are aliased. MCP tools and the names older Traces still carry
  (`kill_command`, `read_image`, `describe_image`, `kill_subagent`) render unchanged in either
  switch position.
- The Trace viewer, the Agent settings tools table and the Cost Center's error codes keep the
  tool's own name, as do every approval rule and every comparison the app makes on a tool name —
  the alias is resolved at the render expression and nowhere else.
- The preference is stored per browser under `penguin.toolAliases`, alongside the other Appearance
  choices.
