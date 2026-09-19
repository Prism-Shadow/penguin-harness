# The Z.AI group's key link opens the global key console

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `model-catalog`
- **PR:** [#13](https://github.com/nicolaepocroianu/penguin-harness/pull/13)

The Z.AI (GLM) group's **Manage keys** link now opens the global platform's key console,
`https://z.ai/manage-apikey/apikey-list` — the platform the group's presets call: AgentHub's GLM
client defaults to the global `https://api.z.ai/api/paas/v4/` endpoint, and the group's pricing
link already pointed at the global docs. The link previously opened the mainland bigmodel.cn
console, whose keys belong to the other platform and fail authentication against the default
endpoint.

A bigmodel.cn key keeps working: point the entry, or `ZAI_BASE_URL`, at
`https://open.bigmodel.cn/api/paas/v4/` — the pairing the group's catalog comment now records
beside the link.
