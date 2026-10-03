# A proposal's implementation is a branch pair, with its PR optional

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `cli`, `web`

[中文版](2026-10-03-impl-branch.zh.md)

A proposal's implementation was registered as a single impl PR. It became an impl branch: a head and the base it is measured against, each a `<remote, branch>` pair, where the remote is a git remote of the proposal's repository that points at GitHub or an `owner/repo` written out. The base no longer defaulted to `dev`. The patch is the merge base of base and head up to head. A PR is optional and attaches to the branch later; registering a PR registers its head and base. Ledger lines written before this change are read as described in [backward compatibility](2026-10-03-backward-compatibility-impl-branch.md).

## Registering and reading

- `PUT …/proposals/:number/impl` took `{ head, base }`, `{ url }` or all three. It answered 400 `impl_remote_unknown` for a remote that names no GitHub repository, 409 `impl_branch_taken` for a head that is already another proposal's, and 409 `impl_pr_mismatch` for a PR whose head is not the declared head. A PR attached to a declared head replaced the declared base with its own.
- `GET …/proposals/:number/impl/diff` answered the patch as `ProposalImplDiff`: both sides resolved, the head and merge-base commits, ahead and behind, each file's added and deleted lines and hunks, and the comparison's GitHub link. It answered 409 `no_impl` when nothing was registered and 502 when GitHub could not be read.
- `ProposalItem` gained `impl` (`head`, `base`, `pr`, `by`, `at`); `implPr` stayed as the PR on that branch.

## Graph, deploy and merge

- On the PR graph, an impl branch with no PR claimed the open PR on the delivery repository whose head branch it is; one that claimed none was listed with the new reason `no-pr`. `ProposalGraphUnplaced.implPr` became nullable and gained `branch`.
- `deploy` of a proposal with a declared head deployed that branch's tip. `ProposalDeployPlan.pr` and `prUrl` became nullable; without a PR, `PENGUIN_DEPLOY_PR` and `PENGUIN_DEPLOY_PR_URL` were empty. A proposal with no impl answered 409 `no_impl` (was `no_impl_pr`).
- Reporting `merged` still checked the PR's merge, so a branch-only impl needed its PR attached first.

## CLI and Web App

- `penguin org proposal impl <n> [url] [--head <remote> <branch> --base <remote> <branch>]` registered the pair, the PR, or both; `--head` and `--base` came together, each with exactly two values. `show` printed `Impl branch: <head> ← <base>` with its PR. The new `penguin org proposal diff <n> [--stat]` printed the patch or the per-file counts. `deploy` named a target without a PR as `<repo>:<branch>`.
- The proposal page gained an Implementation section: head ← base, the PR or a note that none is open yet, and, on request, the changed files with their counts and a link to the comparison on GitHub. The PR graph's unplaced list showed the branch of an impl with no PR.
