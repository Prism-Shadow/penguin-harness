# ModelScope refresh-token compatibility

- **Date:** 2026-09-21
- **Type:** process
- **Scope:** `server`, `model-catalog`
- **PR:** [#814](https://github.com/Prism-Shadow/penguin-harness/pull/814)

[中文版](2026-09-21-backward-compatibility.zh.md)

The [ModelScope authorization change](2026-09-21-modelscope-authorization.md) added server-side refresh metadata without changing the Project TOML schema or invalidating existing model credentials.

## Existing data

Database migration 10 adds the `model_provider_auth_tokens` table for refresh tokens and access-token expiry. Existing `.project_config.toml` files require no migration: the active credential remains in the existing `api_key` field, and an access token saved before this change continues working until it expires. Existing Projects add the ModelScope presets through **Sync presets**.

## Rollback

Earlier builds ignore the new table and continue using the access token from the Project file. Rolling the database back below version 10 drops the stored refresh metadata, so ModelScope requests continue only until that access token expires; authorizing again after returning to this version restores silent renewal.

## Removal schedule

The version-10 migration block and its version-9 fixture stay while upgrades from schema 9 or earlier are supported. The release that raises the minimum supported database baseline above 9 owns removing that migration block and fixture. The `model_provider_auth_tokens` table remains part of the current schema for as long as provider token refresh depends on it.
