# Steering survives reloads and carries files; session list scales

Steering messages no longer vanish on refresh or come back as duplicate-prone drafts, file attachments steer like images do, tool-card subtitles stop jittering while arguments stream, and the sidebar stays fast and scannable with many agents, workspaces, and CLI sessions.

## Steering across reloads, with visible content (#136, #140)

- The server now mirrors each running session's undelivered steering queue (text plus image/file counts) and broadcasts it on every `task_state` event and the SSE subscribe snapshot. The composer's "steering queued" hint shows each queued message's content and survives reloads; entries retire as their `[user_steering]` message reaches the stream, and the mirror drops when the run exits.
- A successful steer discards the localStorage draft, like a normal send — previously the sent text was resurrected as a draft on reload, and re-sending it duplicated the steering message. Draft discard also clears the text ref so a later skill/chip flush cannot bring already-sent text back.
- File attachments now ride steering exactly like images: written to the session scratchpad under the task-attachment rules and delivered as `[attached file: <path>]` lines on the steering text. A file-only draft steers instead of silently falling into the follow-up queue with the other channel's hint; a 409 cleans the written files up.
- New e2e spec: steer during a slow tool run → reload → hint with content, empty composer, exactly-once delivery.

## Tool-card subtitles render once, fully formed (#137)

The collapsed tool row's subtitle (the model-written call description, or the shortened file path) no longer re-renders on every streamed fragment — a growing description re-solved the header's flex line ~8×/s and `shortenPath` on a still-growing path rewrote non-monotonically. A field now renders only once its closing quote has arrived (the gate lifts when argument streaming settles, so aborted calls still show what they have), and a complete description wins over the file path when a user-edited schema enables one on a file tool — the rule the CLI already applied.

## Session list: DB-served by default, CLI sessions opt-in, groups page (#139)

- The sessions index gains DB-only `client` ('web' / 'cli'; NULL = legacy row, treated as web) and `has_trace` columns; existing `web.db` files are upgraded in place by an idempotent ALTER guard on open.
- The default list serves web sessions straight from the DB (SQL-ordered under a new index) with no Trace-directory scanning in steady state; `cli=1` opts into Trace discovery + adoption, and adopted CLI rows stay excluded from the default list while remaining individually reachable (deep links).
- New per-user "Show CLI sessions" switch (default off) in the sidebar user menu, persisted in `ui_prefs`; toggling refetches the list under the new filter.
- Both sidebar grouping modes page the groups themselves: 10 groups initially, "More groups (N)" reveals 10 more — a pure render cap, reset per Project and on a mode switch.
