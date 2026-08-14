# Large tool catalogs can use a fixed search and call gateway

- **Date:** 2026-08-13
- **Type:** feature
- **Scope:** `core`, `cli`, `server`, `web`, `docs`
- **PR:** [#289](https://github.com/Prism-Shadow/penguin-harness/pull/289)

[中文版](2026-08-13-lazy-mcp-tool-exposure.zh.md)

Added `tools.toolExposure` with three modes. `direct` remains the compatible default. `auto`
keeps built-in tools native and moves a large MCP catalog behind fixed `search_tools` and
`call_tool` definitions. `lazy` puts built-in and MCP tools behind the same gateway. Auto decides
once from the initial serialized MCP schema size; `tools.toolExposureThresholdTokens` controls the
cutoff.

Search returns a versioned reference and input schema. Before execution, the gateway resolves the
reference from its private catalog, validates the arguments, and applies the target tool's actual
permission, timeout, output limit, interruption, streaming and Trace behavior. MCP additions,
removals and contract changes update the private catalog without changing the two model-facing
definitions. Stale references fail with an explicit reason and, when available, the replacement
contract. Manual approval shows the registry-resolved target rather than model-provided text.

The change includes deterministic retrieval and context-cost benchmarks, an end-to-end evaluation
runner, and regression coverage for dynamic catalogs, refresh storms, stale references, approval,
schema validation, timeouts and output limits.
