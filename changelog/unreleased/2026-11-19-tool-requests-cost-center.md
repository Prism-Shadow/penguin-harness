# Model tools in Cost Center

- Date: 2026-11-19
- Type: fix
- Scope: server, web

[简体中文](2026-11-19-tool-requests-cost-center.zh.md)

Cost Center includes model tool calls in request counts and success rates. A provider refusal counts as a failure; cancelling a submitted request keeps it out of the success-rate calculation. Tool calls with a Session also appear under its Agent.

Image generation contributes an estimated cost at the current model price. A range appears when an image service omits the billed resolution tier. Voice duration, characters and other physical units stay in tool usage. The Token totals include quantities reported in tokens.
