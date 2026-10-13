# Backward compatibility: Penguin Go routes

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#1063](https://github.com/Prism-Shadow/penguin-harness/pull/1063)

[中文版](2026-10-12-backward-compatibility.zh.md)

Penguin Go's stored legacy routes switch directly to MMSP. [MMSP routing](2026-10-12-penguin-go-mmsp.md) migrates each Project on config load; authorization and catalog sync also apply the platform's MMSP endpoint.

## Migration scope

The built-in `penguin-go` provider id and a Go-owned endpoint identify managed configuration. The existing config migration updates the group and model-level overrides without network requests or a saved key, including retired model ids. It is idempotent and preserves other fields, user-created groups and redirected endpoints. There is no capability negotiation or legacy protocol fallback.

## Removal

At the 0.3.0 release preparation, by whoever prepares it, together with the AgentHub client-type migration (same condition: the release notes say a Project last opened before this release must be opened once on a 0.2.x release first). It takes out the load-time call in `migrateProjectConfigTable`, the no-endpoint branch of `migratePenguinGoRoutes` (the endpoint branch stays: authorization and sync apply the platform's MMSP endpoint with it), the pre-MMSP origin and paths in `isPenguinGoEndpoint`, and the migration tests. Users do nothing. Penguin Go must support MMSP when this Harness version is used.
