# Agents panel: a subagent's description sits a size below its name

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1096](https://github.com/Prism-Shadow/penguin-harness/pull/1096)

[中文版](2026-10-13-subagent-description-size.zh.md)

In the agents panel's call graph, each child node's second line, the description its spawning `run_subagent` call carries, was set at the same size as the agent's name above it, so a Chinese description read as large as the name or larger. The name now uses the body size and the description keeps the small size beneath it, in all three themes.

## Details

- The graph's node boxes, gaps and edges now follow the Font size setting (they are laid out in rem rather than fixed pixels), so both lines fit their box at every size. Before, Frost at XL cut off the bottom of the description.
- At the same font size a long agent name truncates a little sooner; the node's tooltip still shows the full name and description.
