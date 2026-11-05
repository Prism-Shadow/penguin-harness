# Penguin Go account balance

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `docs`
- **PR:** [#1086](https://github.com/Prism-Shadow/penguin-harness/pull/1086)

[中文版](2026-10-14-penguin-go-balance.zh.md)

Added the Penguin Go account balance to the model group's header, with manual refresh and sidebar pinning. A pinned balance refreshes every five minutes while the app is open.

## Details

- Read the CNY ledger's integer units without rounding before converting to the user's display currency.
- Used the stored group key, falling back only to `PENGUIN_GO_API_KEY`. Individual model keys and other providers' environment keys were excluded from balance queries.
- Sent balance queries to the trusted `PENGUIN_GO_ORIGIN` used for authorization. Authorization and balance queries defaulted to `https://go.penguin.ooo`; an explicit `https://token.penguin.ooo` remained supported.
- Reused the existing balance cache and concurrent request handling, with separate readings for each project, provider, endpoint and key. Manual refresh bypassed the cached reading.
