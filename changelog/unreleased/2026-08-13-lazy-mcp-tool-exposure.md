# Tools can be exposed through a fixed gateway

Agents can set `tools.toolExposure` to `auto` or `lazy`. Auto keeps built-in tools native and moves a large initial MCP schema surface behind fixed `search_tools` and `call_tool` gateways. Lazy puts both built-in and MCP tools in the private catalog. Direct remains the default.

Search results carry content-addressed references and input schemas. The gateway validates the reference, arguments, and effective permission before dispatch, then preserves the target tool's approval, timeout, output-limit, interruption, streaming, and Trace behavior. MCP additions, removals, and contract changes update only the private catalog in gateway modes, so the model-facing tool definitions remain fixed for the Session.

Auto estimates serialized MCP schema size once before the first model request and freezes its choice. The repository includes offline schema/retrieval benchmarks, end-to-end evaluation for Direct/Auto/Lazy, and regression coverage for built-in dispatch, dynamic MCP catalogs, stale references, approval, timeout, and output limits.
