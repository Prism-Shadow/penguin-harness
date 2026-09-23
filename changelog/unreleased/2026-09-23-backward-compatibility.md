# Backward compatibility: a root stamped by the chain before its restack has no model tables

- **Date:** 2026-09-23
- **Type:** process
- **Scope:** `server`
- **PR:** [#842](https://github.com/Prism-Shadow/penguin-harness/pull/842)

[中文版](2026-09-23-backward-compatibility.zh.md)

## A root stamped under the old numbering skips main's model tables

Restacking the chain onto main inserted main's `model-promotions` and `model-provider-auth-tokens`
migrations at 9 and 10 and moved everything after them two higher. A data root that ran the chain
before the restack is stamped 16 under the old numbering — where 9 and 10 were `sessions-sandbox` and
`machines-columns` — so the first push of the restacked line reads both model migrations as already
applied, reaches 18 without `model_promotions` or `model_provider_auth_tokens`, and answers 500
wherever cost or provider auth reads them: the models page, an organization's overview. Seen on
the release instance at that first push.

Migration 19, `model-tables-adoption`, re-runs 9's and 10's own DDL — frozen copies, both
`IF NOT EXISTS` — so a root that took them in their proper place finds its work done. Nothing to do
by hand: the next push runs it on the swap path.

## Compatibility

The entry can go once no data root can still be stamped under the pre-restack numbering — the
release that follows the chain's merge is the moment to check; migrations 9 and 10 stay.
