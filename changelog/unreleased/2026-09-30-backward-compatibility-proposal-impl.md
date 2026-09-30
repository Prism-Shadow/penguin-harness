# Backward compatibility: proposal ledgers written before impl PRs

- **Date:** 2026-09-30
- **Type:** process
- **Scope:** `plugins`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#108](https://github.com/Myriad-Dreamin/penguin-harness/pull/108)

[中文版](2026-09-30-backward-compatibility-proposal-impl.zh.md)

## Proposals without an impl PR are adopted once, by a person

A `proposals.jsonl` written before impl PRs has no `impl` line. Its proposals load with no impl PR, and the PR graph shows their PRs as "no proposal". Nothing is read from the `pr` materials at load time.

Once the delivery repository is set, a person runs `penguin org proposal impl --adopt` (`POST …/proposals/adopt-impl`) once per organization. Every proposal that has no impl PR and is not rejected takes its latest `pr` material on the delivery repository as one. Each adoption is an ordinary `impl` line, attributed to that person. The answer lists proposals that had more than one such material, where the latest was taken, and proposals that were skipped because they had none or because that PR is already another proposal's. A run after the first one adopts nothing new. A wrong adoption is corrected with `penguin org proposal impl <n> <url>`.

Where: every organization's `<orgDir>/proposals.jsonl` on a server that runs the plugin. Someone has to act: a person runs the adoption once, after an admin sets **Delivery repository**.

## Compatibility

The adoption (`adoptImpl`, its route and `impl --adopt`) is one-time migration code. It stays until every organization that had proposals before this change has run it. Whoever maintains the proposals plugin checks at the next release preparation and removes it then. After that, a proposal still without an impl PR is registered by hand.
