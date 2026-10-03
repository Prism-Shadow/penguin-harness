# Backward compatibility: impl lines that name only a PR

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `company-proposals`

[中文版](2026-10-03-backward-compatibility-impl-branch.zh.md)

[A proposal's implementation became a branch pair](2026-10-03-impl-branch.md). Every `impl` line written to `proposals.jsonl` before that change carries only a PR (`url` and `label`), with no `head` or `base`.

## The old shape: an impl line with a PR alone

Chosen: **read it in memory, never rewrite the ledger.** An `impl` line with a PR alone folds into an impl branch named by that PR: its head and base are the PR's, read from GitHub when the patch, the PR graph or a deploy needs them. Declaring a head later keeps that PR when GitHub confirms the PR's head is the declared one. The same rule applies to new lines that register a PR before any head is declared.

**A user is not required to do anything.**

## When this can be removed

The PR-only reading stays while any organization's ledger can still have a PR-only line as a proposal's latest `impl` line. It can be removed once a one-time step has appended a `head`/`base` line for every such proposal across supported data roots, and registering a PR without a declared head writes the PR's head and base into the line. The company-proposals plugin maintainers own the removal; the earliest candidate is the first release after both are true.
