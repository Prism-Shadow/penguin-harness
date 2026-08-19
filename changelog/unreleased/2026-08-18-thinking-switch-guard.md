# Web App: confirm a mid-chat thinking-level switch

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#320](https://github.com/Prism-Shadow/penguin-harness/pull/320)
- **Issue:** [#310](https://github.com/Prism-Shadow/penguin-harness/issues/310)

[中文版](2026-08-18-thinking-switch-guard.zh.md)

The active-session composer's thinking-level picker stopped applying a pick silently once the conversation had history. Some providers (DeepSeek in the report) implement the thinking level as a different prompt prefix injected at the very front of the chat template, so a mid-conversation switch invalidated the provider's prefix cache for the whole history and the next request re-billed all of it at the uncached input rate. A pick that would change the level now opens the standard confirmation card, which states that cost and offers three choices.

## The dialog's three choices

- **Compact, then switch** — the recommended action, on the card's primary button. It starts a context compaction through the same path as the composer's `/compact` command and applies the new level **only after that compaction completes successfully**. A compaction that fails, is aborted, or is refused by the server leaves the level untouched and says so, rather than switching onto a context that was never rewritten. Compaction can neither start nor queue while the session is busy, so this choice is disabled with a stated reason unless the conversation is idle, and the other two stay live.
- **Switch anyway** — a neutral button beside it that applies the pick immediately.
- **Cancel** — keeps the current level.

`POST /compact` answers `202` and the outcome arrives later over the stream, so the pick is held while the compaction runs: `compactionTally` snapshots the settled and completed compactions at request time, and `thinkingSwitchAfterCompaction` releases the pick when a new one completes, refuses it when one settles without completing, and otherwise keeps waiting. Counting rather than matching item ids keeps that correct across a stream reconnect, where the worst case is a held pick that is never applied.

## When the dialog is skipped

- The conversation has no messages yet, so a brand-new session's initial selection stays free.
- The pick equals the level the picker already displays, which merely pins the level for the session.
- The transcript ends in a successful compaction, so whoever took the "compact, then switch" path was not warned a second time.

The draft picker (no session yet, writes through to the Agent settings) was left unchanged.

## Details

- Guard and sequencing logic went into `thinking-level.ts` as pure functions — `prefixCacheAtRisk`, `needsThinkingSwitchConfirm`, `compactionTally`, `thinkingSwitchAfterCompaction` — covered by unit tests.
- The shared `ConfirmModal` gained an optional third action (`secondaryLabel` plus `onSecondary`, rendered as a neutral button between Cancel and Confirm) and a `confirmDisabled` flag that greys out the primary button alone. Both default off, leaving the previous two-button card and its other call sites unchanged. The button row wraps, because three long labels do not fit one row in a phone-width bottom sheet.
- The server's `compacting` error code gained a localized message.
- The bilingual Web App docs describe the flow.
