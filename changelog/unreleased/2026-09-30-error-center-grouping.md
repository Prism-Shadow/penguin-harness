# The error center folds a day's repeats into one counted row, and messaging failures that recover on their own are expected

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#908](https://github.com/Prism-Shadow/penguin-harness/pull/908)

[中文版](2026-09-30-error-center-grouping.zh.md)

The cost center's error table folded the records of one day that share a source, code, kind and message into one row that says how many there were, and the messaging connection and send failures that clear on their own were filed as `expected` instead of `unexpected`.

## Details

- **One row per error per day.** `GET /usage` and `GET /usage/errors` took an optional `utcOffsetMinutes`, the reader's offset east of UTC, which the Web App sends from the browser, and the error table folded its records by the reader's calendar day, source, code, kind and message. Each row (`UsageErrorItem`) carried `count`, its latest time `ts` and its first time `firstTs`, newest first. Paging counted rows, and both responses gained `rows`, the row count, while `total`, the unexpected count and the most common code kept counting records. Without an offset the day was the server's own. Clearing still deleted records, and the recorder's short-window dedup and row cap were unchanged.
- **The panel.** A row standing for several records showed a small muted "×N" after its message, its time was the latest one and its tooltip gave the first, and the pager counted rows ("25 rows").
- **A verdict on each connection and send failure.** `MessagingChannelError`, on the connector seam, carried `recovers`, decided where a failure is read. The Telegram, QQ and WeChat transports marked a request that never completed and an HTTP 408, 429 or 5xx as recovering, and WeChat also its `-14` session timeout and any refusal after its credential passed, such as a send's "prepare failed". The QQ gateway added its handshake timeout, heartbeat loss, a reconnect the platform asked for, and the transport closes 1001, 1006 and 1011–1014 to 4009 and 4900–4913. `TelegramApiError`, `QQApiError`, `WeChatApiError` and `MessagingConnectionClosedError` became kinds of it.
- **The classification.** `messagingErrorKind` filed a failure at `messaging_connect_failed` or `messaging_send_failed` as `expected` when its verdict recovers, and as `unexpected` otherwise, untyped failures included. A rejected credential, a missing permission, a Telegram webhook or second poller (409), a chat that blocked the bot and QQ's reply budget stayed `unexpected`. The other capture points kept their rules, and Feishu, whose long connection reports only once its SDK has given up, gained no verdict.
- **One report per outage.** Telegram's and WeChat's poll loops took the QQ gateway's rule: a failure that recovers does not use up the outage's one report, so the first failure after it that does not recover is filed as well.
- **Existing records.** Rows already in the table kept the kind they were filed with.
- **Docs.** The Cost Center and Server API pages described the folded rows, `utcOffsetMinutes` and `rows`, and how connection and send failures are classified.
