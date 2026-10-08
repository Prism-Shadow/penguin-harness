# WAF layout patterns, as a skill

- **Date:** 2026-10-08
- **Type:** feat
- **Scope:** `plugins`

The `waf-authoring` plugin gains `waf-layout-patterns`, ported from Loom's
`backend/AgentsLayout.md`. It catalogues how the real WAF modules position, show and hide,
clean up, highlight, layer and animate elements, with the module each pattern came from,
which none of the ported skills covered.

Some of those modules predate the rules in the other WAF skills, so the skill opens by
saying which rule wins: `waf-style-guardrails` for sizing and placement,
`waf-element-ids` for ids, and `waf-sequence-implementation-patterns` for input.

The sequence path's implementation skill list now names it, after `waf-style-guardrails`.
Module runs today scaffold the state machine path, so it reaches a run once a sequence
module is built or edited; until then it reaches an agent through the plugin.
