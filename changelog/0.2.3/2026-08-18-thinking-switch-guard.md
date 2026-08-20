# Web App: confirm a mid-chat thinking-level switch, and keep the picked level

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#320](https://github.com/Prism-Shadow/penguin-harness/pull/320)
- **Issue:** [#310](https://github.com/Prism-Shadow/penguin-harness/issues/310)

[中文版](2026-08-18-thinking-switch-guard.zh.md)

The active-session composer's thinking-level picker applied a pick silently, even in the middle of a long conversation where switching lowers the provider's prompt-cache hit rate and raises the cost of the next request. A pick that would change the level now opens the standard confirmation card, which says exactly that in one sentence and offers three choices. The picked level is also stored on the Session, so it no longer evaporates on reload.

## The dialog's three choices

- **Compact, then switch** — the recommended action, on the card's primary button. It starts a context compaction through the same path as the composer's `/compact` command and applies the new level once that compaction ends. A compaction that fails or is aborted still applies the level (the switch is what the user asked for) and says that the compaction did not finish, so nobody is left assuming the context was rewritten. Compaction can neither start nor queue while the session is busy, so this choice is disabled with a stated reason unless the conversation is idle, and the other two stay live.
- **Switch anyway** — a neutral button beside it that applies the pick immediately.
- **Cancel** — keeps the current level.

`POST /compact` answers `202` and the outcome arrives later over the stream, so the pick is held while the compaction runs — holding it is about order, not about a veto: a level applied mid-compaction would ride on anything sent in between and invalidate the very cache the compaction is there to shrink. `compactionTally` snapshots the settled and completed compactions at request time, `compactionSettledSince` reports how the next one ended, and `heldThinkingSwitch` turns that into the release decision (apply now, and with which notice). Counting rather than matching item ids keeps that correct across a stream reconnect.

## The picked level survives a reload

The level used to live in React state only: a refresh re-initialized the picker from the Agent config and the user's choice silently reverted. It is now a Session field.

- `sessions.thinking_level` (nullable, added through the existing `ensureColumn` upgrade path — no migration) backs a new `SessionInfo.thinkingLevel`, written with `PATCH /api/sessions/:sessionId { thinkingLevel }` (`none | low | medium | high | xhigh`, anything else is a 400).
- The server applies it to every run that carries no level of its own — tasks, queued follow-ups and goal runs alike, resolved at launch time in `SessionManager` — so the fallback chain becomes: the request's own level, then the Session's pinned level, then the Agent config's.
- Unset (the default for a new Session) keeps the previous behavior exactly: the picker displays the Agent config's level and auto-follows it, and runs fall back to it. Once pinned, an Agent-config edit no longer moves the session, which is the point of pinning it.

## When the dialog is skipped

- The conversation has no messages yet, so a brand-new session's initial selection stays free.
- The pick equals the level the picker already displays, which merely pins the level for the session.
- The transcript ends in a successful compaction, so whoever took the "compact, then switch" path is not warned a second time.

The draft picker (no session yet, writes through to the Agent settings) is unchanged.

## Details

- Guard, sequencing and display rules went into `thinking-level.ts` as pure functions — `prefixCacheAtRisk`, `needsThinkingSwitchConfirm`, `compactionTally`, `compactionSettledSince`, `heldThinkingSwitch`, `sessionThinkingLevel` — covered by unit tests, including that a failed compaction still switches and that a pinned level beats a changed Agent config.
- The shared `ConfirmModal` gained an optional third action (`secondaryLabel` plus `onSecondary`, rendered as a neutral button between Cancel and Confirm) and a `confirmDisabled` flag that greys out the primary button alone. Both default off, leaving the previous two-button card and its other call sites unchanged. The button row wraps, because three long labels do not fit one row in a phone-width bottom sheet.
- The server's `compacting` error code gained a localized message.
- The bilingual Web App and Server API docs describe the flow and the new field.
