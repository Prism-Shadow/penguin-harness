# Sync presets keeps your base URL, key and output cap

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-21-sync-presets-keeps-deployment-fields.zh.md)

**Sync presets** used to reset every catalog-owned field on a preset model that was already configured, and the base URL was one of them. A model pointed at a proxy, a self-hosted gateway or a company egress lost that endpoint on the next sync: the built-in catalog carries no base URL for a first-party vendor model, so the field was overwritten with nothing and the model stopped working. A sync now updates what the catalog knows about the model and leaves how this installation reaches it alone.

## Details

- Never overwritten on a model that is already configured: base URL, API key, max output tokens and fast mode. The output cap and fast mode were already safe; the base URL joins them, and the key was never part of the write.
- Still refreshed from the catalog: context window, pricing, protocol, vision support and the promotion. Re-running the sync remains the way to repair a built-in model saved before the catalog pinned its protocol.
- An **empty** base URL is filled in from the catalog where the catalog has one. A gateway model, or a preset in the `custom` group such as Atria, reaches nothing without an endpoint, so a blank field on those rows is damage rather than a choice — the same repair a blank display name already gets, with the same consequence that a deliberately cleared one comes back.
- The Models badge follows the same rule: a base URL of your own is no longer counted as "out of date", so the dot cannot point at a button that would refuse to change it.
- The button's hint and the confirmation dialog now name both lists.

A base URL an earlier sync already cleared cannot be brought back — the old value is no longer in `.project_config.toml`. Enter it again on the model, and from now on it stays.
