# Penguin Go MMSP routing

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `server`, `docs`
- **PR:** [#1063](https://github.com/Prism-Shadow/penguin-harness/pull/1063)

[中文版](2026-10-12-penguin-go-mmsp.zh.md)

Penguin Go presets, new authorization, reauthorization and model sync use the MMSP HTTP client directly. Existing Project configurations migrate on load.

## Routes and requests

- Device authorization polling and detailed catalog sync send `x-penguin-protocol: mmsp`.
- All Go models use MMSP, including catalogs that also list legacy routes. An MMSP-only catalog needs no legacy endpoint fields.
- The platform supplies the base URL, normally `https://go.penguin.ooo/api/v1`; the SDK appends `/stream` and carries done history, tools, thinking, media and usage.

## Existing Projects

Migration updates the group's routing and model overrides without a network probe or new login, retaining ids, keys, selections, account metadata, prices, promotions and custom model settings. User-created groups and redirected endpoints remain untouched. See [backward compatibility](2026-10-12-backward-compatibility.md).
