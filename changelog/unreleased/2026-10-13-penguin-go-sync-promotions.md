# Penguin Go: models the group already holds show the platform's discount

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`, `docs`

[中文版](2026-10-13-penguin-go-sync-promotions.zh.md)

Connecting Penguin Go and its **Sync models** now give the models the group already holds the promotion the platform runs, so their cards show the discount and the cost center bills what the platform bills. Until now only the models a sync added got one, and the group's preset models never showed a discount.

## Details

- A model whose price is the platform's list price takes the platform's promotion, and loses it when the platform ends it.
- A model stored at the price the platform bills under a promotion goes back to the list price with the promotion beside it. What it bills does not change.
- A model whose price you changed keeps your price and gets no promotion. Sync still never rewrites the price, protocol or any other setting of a model already there.
