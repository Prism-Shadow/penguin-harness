# Only a roadmap creates an employee's proposal

- **Date:** 2026-09-30
- **Type:** feat
- **Scope:** `plugins`, `cli`
- **PR:** PR_LINK
- **Breaking:** an employee's `penguin org proposal create` is refused; company-roadmaps needs company-proposals installed beside it

[中文版](2026-09-30-only-a-roadmap-creates-a-proposal.zh.md)

An employee no longer creates a proposal. `POST …/proposals` (`penguin org proposal create`) answers an employee 403 `roadmap_only`, writes nothing, and says where to go instead: a new proposal comes from a roadmap item that a person and the moderator approved, and a change of an existing proposal is a new revision of it. A person's `create` is unchanged.

A roadmap item's second approval now creates its proposal itself. In the same step it creates the proposal in company-proposals (the item's owner is the author, the item's title and brief are its own), links it to the item, and tells the owner the number. The owners stacked on it learn the number too. The proposal's `created` line records the roadmap and the item it came from (`roadmap: { number, key }`). If the proposal cannot be created, the approval is refused (409 `proposal_not_created`), nothing is recorded, and it can be given again. Adopting an existing proposal, and linking a brief item to the proposal it already is, create nothing, as before.

The CLI help for `proposal create` and the `proposal-author` skill (version `2026.09.30.2`) say the same.

## Compatibility

- An employee, the CEO included, that runs `penguin org proposal create` gets 403 `roadmap_only`. Backfilling a proposal for an existing PR is a person's `create`.
- company-roadmaps requires company-proposals' module (`CompanyProposalsPlugin`). A Project that lists company-roadmaps without company-proposals no longer boots its plugins; list both, as the README always asked.
- Items that had both approvals before this version and have no proposal yet are not created retroactively: a person creates the proposal, and the owner or a person links it, as before.
