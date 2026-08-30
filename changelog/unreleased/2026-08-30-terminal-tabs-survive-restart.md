# A machine's terminal survives a restart, and opening one finds it

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#552](https://github.com/Prism-Shadow/penguin-harness/pull/552)

[中文版](2026-08-30-terminal-tabs-survive-restart.zh.md)

A terminal running on a machine was lost from the app on every restart: its tab disappeared, and opening a terminal started a second shell beside the one already running there. The pty was never in danger — it lives on that machine's server, which kept running the whole time.

## Details

- The terminal list is assembled from several sources — this server, plus each machine the Project reaches — and it prunes terminal tabs out of every conversation's stored arrangement against what it sees. On a fresh page neither the machine set nor a forward to a machine exists yet, so an early refresh saw this server alone and pruned away the tabs of terminals that were alive elsewhere. Pruning now waits for a complete picture: the machine set published, and every source answering. Displaying the shorter list meanwhile is unchanged.
- Opening a terminal looked for an existing shell to adopt by asking `/api/terminals` without naming a machine, which answers for this server only, so a conversation on a machine never found the shell it already had there. It now looks through the same multi-source list, and adopts only a shell on the machine the conversation itself is on — the rule that already decided where a new shell is created.
