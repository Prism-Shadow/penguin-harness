# Web App: confirm before a mid-chat thinking-level switch (prefix-cache guard)

Some providers (DeepSeek is the reported example) implement the thinking level by injecting a different prompt prefix at the very front of the chat template — off/low means none, high and max each mean a different long prefix. Switching the level in the middle of a conversation therefore invalidates the provider's prefix cache for the entire history, and the next request re-bills all of it at the uncached input rate (#310).

The active-session composer's thinking-level picker no longer switches silently once the conversation has history: a pick that would change the level opens the standard confirmation card, which explains the prefix-cache cost, advises running `/compact` first, and offers "Switch anyway" to force the change (Cancel keeps the current level). The dialog is skipped whenever the switch cannot hurt:

- the conversation has no messages yet (a brand-new session's initial selection stays free);
- the pick equals the level the picker already displays (it merely pins the level for the session);
- the transcript ends in a successful compaction — the user who followed the "compact first, then switch" advice is not warned a second time.

The draft picker (no session yet, writes through to the Agent settings) is unchanged. Guard logic lives in `thinking-level.ts` as pure functions (`prefixCacheAtRisk`, `needsThinkingSwitchConfirm`) with unit tests; the web-app docs (en/zh) document the flow.
