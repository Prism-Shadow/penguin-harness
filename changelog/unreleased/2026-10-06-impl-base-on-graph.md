# An impl base must be on the PR graph, and an off-chain row says why

- **Date:** 2026-10-06
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`, `cli`

[中文版](2026-10-06-impl-base-on-graph.zh.md)

Registering a proposal's impl gained two default rules that keep the PR graph drawable, and a node off the chain because of its base said what fixing it takes. Only validation and display changed: registered impls were not rewritten.

## Details

- `proposal.impl` refused a base the request names with 400 `base_not_on_graph` unless it was the graph's base branch, the impl head of another proposal that is not merged or rejected, or the head of an open PR on the delivery repository in the graph as last read (no network inside the write). The refusal named the bases it would accept. With no graph read yet, the open PRs were skipped and the answer's `hints` said so; `penguin org proposal impl` printed them.
- `proposal.impl` refused with 409 `base_in_use` a merged PR (as GitHub answered the registration's own read of the PR, else as its cached status said) when its head branch is still the registered base of another proposal that is not merged or rejected, naming those proposals. An unknown status was not refused.
- Both rules ran inside the write as part of the default guard of `proposal.impl`, so a company workflow replacing that guard can change them.
- The graph node's `off` became `ProposalGraphOff`, with optional `missing` (the base the graph draws no node for) and `by` (`{ proposal, pr? }`: the proposal that registered that base, or the proposal whose merged PR took the base branch off the graph).
- The PR graph page's rows showed that detail under an off-chain node, in both languages.
