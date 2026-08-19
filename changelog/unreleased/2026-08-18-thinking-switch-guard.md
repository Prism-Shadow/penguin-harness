# Web App: confirm before a mid-chat thinking-level switch (prefix-cache guard)

Some providers (DeepSeek is the reported example) implement the thinking level by injecting a different prompt prefix at the very front of the chat template — off/low means none, high and max each mean a different long prefix. Switching the level in the middle of a conversation therefore invalidates the provider's prefix cache for the entire history, and the next request re-bills all of it at the uncached input rate (#310).

The active-session composer's thinking-level picker no longer switches silently once the conversation has history: a pick that would change the level opens the standard confirmation card, which explains the prefix-cache cost and offers three choices —

- **Compact, then switch** (the recommended, primary action): starts a context compaction through the same path as the composer's `/compact` command and applies the new level **only after that compaction completes successfully**. A compaction that fails, is aborted, or is refused by the server leaves the level untouched and says so, rather than switching silently onto a context that was never rewritten. Compaction cannot be started (or queued) while the session is busy, so this choice is disabled with a stated reason unless the conversation is idle.
- **Switch anyway**: applies the pick immediately (the force path).
- **Cancel**: keeps the current level.

The dialog is skipped whenever the switch cannot hurt:

- the conversation has no messages yet (a brand-new session's initial selection stays free);
- the pick equals the level the picker already displays (it merely pins the level for the session);
- the transcript ends in a successful compaction — the user who took the "compact, then switch" path is not warned a second time.

The draft picker (no session yet, writes through to the Agent settings) is unchanged. Guard and sequencing logic live in `thinking-level.ts` as pure functions (`prefixCacheAtRisk`, `needsThinkingSwitchConfirm`, `compactionTally`, `thinkingSwitchAfterCompaction`) with unit tests; the shared `ConfirmModal` gained an optional third action and a `confirmDisabled` flag (both default to the previous two-button card, so its other call sites are unchanged); the `compacting` server error code is now localized; the web-app docs (en/zh) document the flow.
