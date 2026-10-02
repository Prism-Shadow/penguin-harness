# Backward compatibility: sandbox settings saved before the switch

- **Date:** 2026-10-02
- **Type:** feat
- **Scope:** `server`

[中文版](2026-10-02-backward-compatibility-sandbox-switch.zh.md)

[The Sandbox card's switch](2026-09-30-simple-sandbox-settings.md) is stored as `enabled` in the sandbox's settings document (`plugin-config:sandbox` in `web.db`). Documents saved before it have no `enabled`.

## The old shape: no `enabled`

Such a document reads the switch as **on when its policy confined anything**: a mode other than Off, or Off with the network cut or masked paths. Otherwise it reads as off. The card shows that value and the server applies it, so a deployment that was confined stays confined and one that was not stays open. The document on disk is not rewritten; `enabled` is written only when an administrator changes the switch and saves the card.

This applies to every data root, on start and on a hot push alike. **A user is not required to do anything.**

## When this can be removed

The fallback lives in `sandboxEnabledOf` (`packages/server/src/sandbox/settings-store.ts`). Because a save writes only the fields it changes, a document keeps lacking `enabled` until its switch is changed, so the fallback cannot expire on its own. It can be removed once the maintainers choose either a one-time migration that writes `enabled` into such documents, or an announced break that reads them as off; until then it costs one comparison per read.
