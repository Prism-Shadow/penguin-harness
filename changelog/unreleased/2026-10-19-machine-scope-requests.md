# A conversation on a machine lists its Agent's Skills from that machine, and every Agent-level request names its machine

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1254](https://github.com/Prism-Shadow/penguin-harness/pull/1254)

[中文版](2026-10-19-machine-scope-requests.zh.md)

On a conversation that lives on a machine, the composer's skills dropdown and slash menu, and those of the subagent panel's composer, now list the Skills installed on that machine's Agent. They used to ask this server, which listed the Skills of its own Agent of the same id, or none.

## Details

- The conversation page, the new-chat draft and the subagent panel read an Agent's Skills through one hook that takes the Agent's machine: the conversation Session's machine, the machine of the draft's picked folder, and for a subagent its parent Session's machine.
- Every Web App request wrapper for an Agent-, Workspace- (directory) or Project-config-level resource takes the machine as a required argument, `null` naming this server, so a call that leaves it out no longer compiles. The calls that are this server's by design pass `null` explicitly: Project settings, the models page, the plugin market, the bulk kernel and plugin updates, the `/agent` handoff, company employees and Benchmarks.
- The Workspace finder no longer asks this server for the Agent's config while another machine is browsed; the tooltip of "Start in a temporary workspace" names no folder there, as before.
