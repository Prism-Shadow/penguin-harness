# Backward compatibility: sandbox settings saved before the switch

- **Date:** 2026-10-02
- **Type:** feat
- **Scope:** `server`

[中文版](2026-10-02-backward-compatibility-sandbox-switch.zh.md)

[The Sandbox card's switch](2026-09-30-simple-sandbox-settings.md) is stored as `enabled` in the sandbox's settings document (`plugin-config:sandbox` in `web.db`). Documents saved before it have no `enabled`.

## The old shape: no `enabled`

Such a document reads the switch as **on when its policy confined anything**: a mode other than Off, a network that is not open, or masked paths. Otherwise it reads as off. The card shows that value and the server applies it, so a deployment that was confined stays confined and one that was not stays open. The document on disk is not rewritten; `enabled` is written only when an administrator changes the switch and saves the card.

## The old shape: `mode` and `network`, no `defaultPreset`

The card no longer has its own confinement mode and network: new Sessions start from the default preset. A stored document without `defaultPreset` keeps confining new Sessions by its own `mode` and `network` (with its temp directory and masked paths), which the card does not show, **until the card is saved once**. Every save of the card writes `defaultPreset` (Workspace Write unless another row is picked), and from then on the default preset decides. Reads never rewrite the document.

Both apply to every data root, on start and on a hot push alike. **A user is not required to do anything**, but the first save of the card changes what new Sessions start from to the default preset; check the Default column before saving.

## When this can be removed

Both fallbacks live in `packages/server/src/sandbox/settings-policy.ts` (`sandboxEnabledOf`, `sandboxStartOf`). Because a save writes only the fields it changes, a document keeps lacking `enabled` until its switch is changed, and keeps lacking `defaultPreset` until the card is saved, so neither fallback expires on its own. They can be removed once the maintainers choose either a one-time migration that writes `enabled` and `defaultPreset` into such documents, or an announced break that reads them with the switch off and the shipped default preset; until then they cost a few comparisons per read.
