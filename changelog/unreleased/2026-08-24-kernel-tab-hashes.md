# The kernel update matches one hash per settings tab

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#438](https://github.com/Prism-Shadow/penguin-harness/pull/438)
- **Breaking:** yes — a kernel update now keeps or advances a whole settings tab, so editing one field of a tab freezes the rest of that tab until the default configuration is restored.

[中文版](2026-08-24-kernel-tab-hashes.zh.md)

Changed the unit of the kernel update from a config leaf to an Agent settings **tab**. `KERNEL_HASH_HISTORY` — six generations of built-in defaults, each a full snapshot of all 21–29 kernel-managed leaves, 158 stored entries — became two flat tables keyed by tab: `KERNEL_DEFAULT_TAB_HASHES` (7 hashes, one per tab) and `KERNEL_SUPERSEDED_TAB_HASHES` (6 hashes, the tab values earlier kernels shipped). Per tab a kernel update now asks one question: absent from the config, hash-equal to the current default, hash-equal to a superseded default, or none of those — and rewrites, skips, rewrites or keeps the tab whole.

## Details

- Defined the managed tabs in `KERNEL_TABS`, mirroring the settings page's own tab order: `prompt` (`system_prompt`), `runtime` (`max_turns`, `model`, `compaction`), `tools` (`tools.builtin`), `skills`, `memory`, `vault`, `schedules`. The Overview tab and `tools.mcpServers` are owned by no tab, so name, description, the Agent State version and MCP Servers stay untouchable.
- A tab hash covers everything the tab owns, so a key the user added anywhere inside it changes the hash and the tab is kept rather than overwritten. A tab the config lacks entirely hashes to nothing and is materialized from the defaults, which is how a config predating the prompt-injection sections still receives them.
- Deleted what the leaf-wise rule needed and the tab-wise one does not: the per-tool merge of `tools.builtin`, the `addedIn` arrival dates and the `newInLatestGeneration` test they fed, and the leaf machinery `kernelLeafEntries` / `KernelLeaf` / `computeKernelHashes` / `historicalHashesFor`. A tools tab that advances is rewritten from the defaults, which brings tools added since; a tools tab that is kept is kept whole, which preserves a tool the user deleted.
- Reported `advanced` / `kept` entries became tab keys instead of dotted leaf paths. The Web App renders them with the settings page's own tab labels, replacing the per-leaf display dictionary and its per-tool special case; the update's confirm and result copy now speaks of tabs in both languages.
- Reworked the pinned-hash guard to compare `computeKernelTabHashes(defaultSystemConfig())` against `KERNEL_DEFAULT_TAB_HASHES`, with the failure message naming the tabs that moved and the edit each needs.
- Carried the generation narrative over as prose on the record: the pre-[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) template with its hardcoded Vault and Skills sections, the toggles generation, `run_subagent` gaining `thinking_level` and then the widened `max` ladder, `compaction.max_context_length` rising to 256000, and the background-execution batch alongside the reworded memory prompt.
- Derived the six superseded tab hashes from the built-in defaults as they stood at each recorded generation, and checked every reconstruction against the retired per-leaf table before writing the literals. Kept the pre-#257 reconstruction proof, retargeted to the prompt tab.
- Updated the configuration guide's merge description and developer paragraph in both languages.

## Compatibility

The stored `system_config.yaml` is unchanged — same format, same fields, same `kernel_version` stamp — and no config on disk needs migrating.

What changes is what an update does for an Agent whose settings were partly customized. Previously the merge ran field by field: editing one built-in tool kept that tool and let every other tool follow the new defaults. Now the Tools tab is kept whole, so that Agent stops receiving tool updates — new built-in tools included — until its configuration is refreshed. The same holds for every other tab: one edited field in Runtime keeps the whole Runtime tab. A tab whose fields are only partly present is likewise kept as written rather than having its missing fields filled in; those fields keep falling back to the built-in defaults at runtime, as they did before.

The recourse is unchanged and sits next to the update on the settings overview: **restore the default configuration** overwrites the config with the current defaults, keeping only name, description and the State version. The kernel update's result lists every tab it kept, so the tabs that have fallen behind are named each time it runs.
