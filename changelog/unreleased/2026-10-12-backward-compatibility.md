# Backward compatibility: Penguin Go routes

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `core`, `server`

[中文版](2026-10-12-backward-compatibility.zh.md)

Penguin Go's stored legacy routes switch directly to MMSP. [MMSP routing](2026-10-12-penguin-go-mmsp.md) migrates each Project on config load; authorization and catalog sync also apply the platform's MMSP endpoint.

## Migration scope

The built-in `penguin-go` provider id and a Go-owned endpoint identify managed configuration. The existing config migration updates the group and model-level overrides without network requests or a saved key, including retired model ids. It is idempotent and preserves other fields, user-created groups and redirected endpoints. There is no capability negotiation or legacy protocol fallback.

## Removal

Keep the stored-route migration until supported Harness releases have migrated existing configurations. The Go integration maintainer removes it after that condition is verified. Penguin Go must support MMSP when this Harness version is used.
