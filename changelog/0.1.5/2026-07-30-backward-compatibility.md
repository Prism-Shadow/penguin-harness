# Backward compatibility in this batch

- **Date:** 2026-07-30
- **Type:** process
- **Scope:** `web`
- **PR:** [#130](https://github.com/Prism-Shadow/penguin-harness/pull/130)

[中文版](2026-07-30-backward-compatibility.zh.md)

Per the repo rule, every compatibility decision of the batch is recorded here once; the feature entries reference this file instead of re-telling it.

## The two per-panel width preferences are adopted into one shared key

The Workspace files panel and the Agents panel each persisted their own dragged width — `penguin.filesPanelWidth` and `penguin.subagentsPanelWidth` in localStorage. They now share a single width under `penguin.panelWidth`, so a stored value has to be carried across or every user who had ever dragged a panel would silently snap back to the default on first load after upgrading.

**Old shape tolerated:** either legacy key. On the first read after upgrading, both are consulted and the **wider** of the two is adopted into the new key, then both legacy keys are deleted. Widest wins because the two panels were sized independently: taking whichever key happened to be read first could hand the merged panel the narrower of the user's two choices, which reads as a regression on whichever panel used to be wide.

**Scope:** browser localStorage only — no server-side data, no config file, no Trace. A user with neither key (or with storage unavailable) gets the proportional default, as before.

**User action:** none. The migration is silent and one-way; nothing needs re-dragging.

**Removal:** the block is `LEGACY_WIDTH_KEYS` and `storedWidth()` in `packages/web/src/features/chat/use-panel-width.ts`. It is self-cleaning — it deletes the legacy keys as it reads them — so it is dead code for anyone who has opened the Web App once since this release. **It should be deleted in the release after next** (i.e. two releases from the one shipping this batch), by whoever prepares that release; the comment at the site says the same. Nothing else in the repo reads those keys, so removing it is a pure deletion with no visible effect. Leaving it longer costs only the dead branch — there is no correctness reason to keep it.

## Panel visibility and the draft page's example layout are not compatibility surfaces

Both changed behavior in this batch, and neither reads persisted state: panel open/closed is in-memory per session (it was never stored), and the example folders' open state is component state that resets on mount. An upgrading user sees the new behavior immediately with nothing to migrate.

## The renamed navigation entries and removed strings need no handling

`nav.railAgents` and `benchmark.maxScore` are deleted from both dictionaries, and several `nav.*` values changed wording. UI copy is compiled into the bundle rather than persisted or referenced by stored data, so there is no old shape to tolerate. Recorded here only to state that the check was made.
