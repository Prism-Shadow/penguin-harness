# The Trace panel prices each request at the tier it ran in

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#659](https://github.com/Prism-Shadow/penguin-harness/pull/659)

[中文版](2026-09-10-trace-panel-tiered-cost.zh.md)

The Trace panel's per-turn and per-file costs are now priced by the server with the cost center's own rule, so a Session's Trace files add up to the cost the conversation toolbar and the cost center show for the same requests. Before this change the panel priced every request at the Project's stored rate, while the toolbar and the cost center billed each request at the tier its own timestamp fell in — for a model on a time-based schedule (DeepSeek's off-peak half price) the panel's files therefore added up to more than the toolbar showed, by half the cost of every request that ran off-peak.

## Details

- The Trace analysis response carries a `cost` per turn and a file-level `cost` (USD), each Request priced at the Project's current rates for the file's model, at the tier that Request's timestamp fell in — the same pricing lookup and the same tier rule the cost center applies to the usage row the same `token_usage` produced. A model with no pricing, or a legacy Trace head naming no provider, carries no `cost`.
- The Trace file view reads those figures instead of pricing the turns itself, and no longer fetches the Project's model list.
- The pricing formula and the per-record tier decision are shared helpers of the usage service, so the SQL aggregation and the per-file analysis price one request the same way.
- The docs note that the Trace view and the cost statistics share the pricing rule, not only the data.
