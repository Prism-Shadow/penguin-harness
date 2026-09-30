# An employee reports a proposal merged once GitHub reads its impl PR as merged

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`

[中文版](2026-09-30-proposal-merged-anyone.zh.md)

`penguin org proposal merged <n>` (`POST …/proposals/:number/merged`) no longer answers 403 `not_implementer` to an employee that is not the proposal's implementer. The status is checked first (409 `proposal_status` unless `approved`). A person and the implementer then report on their word, as before. Any other employee in the organization reports on GitHub's word instead: the proposal's impl PR (`penguin org proposal impl`) is read from GitHub at that moment, past the page's one-minute cache, and must be merged into its repository's default branch. Without an impl PR the answer is 409 `impl_pr_missing`. An impl PR that is open, closed, merged into another branch, or unreadable is answered with 409 `impl_pr_not_merged`, and the message names which. The `status` line records who reported (`by`).

The approval notice to the author of a proposal nobody is building no longer tells them to run a command they could not: it names the impl PR, or how to register one, and says to run `merged` once it is merged into the default branch.
