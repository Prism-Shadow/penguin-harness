# Backward compatibility: sandbox settings saved before the switch

- **Date:** 2026-10-02
- **Type:** feat
- **Scope:** `server`

[中文版](2026-10-02-backward-compatibility-sandbox-switch.zh.md)

[The Sandbox card's switch](2026-09-30-simple-sandbox-settings.md) is stored as `enabled` in the sandbox's settings document (`plugin-config:sandbox` in `web.db`). Documents saved before it have no `enabled`.

## The old shape: no `enabled`

Such a document reads the switch as **on when its policy confined anything**: a mode other than Off, a network that is not open, or masked paths. Otherwise it reads as off. The card shows that value and the server applies it, so a deployment that was confined stays confined and one that was not stays open. The document on disk is not rewritten; `enabled` is written only when an administrator changes the switch and saves the card.

## The old shape: `mode` and `network`, no `defaultPreset`

The card no longer has its own confinement mode and network: new Sessions start from the default preset. A stored document with its own `mode` or `network` (or masked paths, which the old Off mode stored alone) and no `defaultPreset` keeps starting new Sessions from its own `mode` and `network`, with its temp directory and masked paths, **until an administrator picks a row in the Default column**. The card shows that start as it is:

- **A row gives exactly the same start** — making it the default would change neither a new Session's policy (file mode, network, temp directory, masked paths) nor its approval mode. The Default column marks that row (the first in table order), and a save writes it as `defaultPreset`. In the shipped table those are Workspace Write and Read Only, each for the old mode of the same name with the network open.
- **No row does** — the old network was none or localhost only, or the old mode was Off with masked paths (Full Access confines nothing, so it does not match). The Default column marks no row, a notice at the top of the card names the values in effect and how to change them (star a row, or add a preset with those values and star it), and a save of other fields writes no `defaultPreset`: the start stays the old one.

A document without `mode` or `network` (a fresh install, or one saved only through the new card) is not of this shape: every save writes `defaultPreset`, Workspace Write unless another row is picked. A save of the card therefore never loosens a confined deployment on its own: the default preset decides new Sessions, and the ceiling for non-admins, only once an administrator has picked a row. Reads never rewrite the document.

Both apply to every data root, on start and on a hot push alike. **A user is not required to do anything.**

## When this can be removed

Both fallbacks live in `packages/server/src/sandbox/settings-policy.ts` (`sandboxEnabledOf`, `sandboxStartOf`). Because a save writes only the fields it changes, a document keeps lacking `enabled` until its switch is changed, and keeps lacking `defaultPreset` until a save pins a row (at once where a row matches, otherwise when an administrator picks one), so neither fallback expires on its own. The pre-preset reading also covers `prePresetStartOf` and the card's notice (`prePresetNotice`) in the same file, and the derive and saving hooks in `settings-store.ts` that use them. They can be removed once the maintainers choose either a one-time migration that writes `enabled` and `defaultPreset` into such documents, or an announced break that reads them with the switch off and the shipped default preset; until then they cost a few comparisons per read.
