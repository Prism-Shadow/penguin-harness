# A machine's reconnect reads as one line, stops after five attempts, and can be stopped

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `docs`
- **PR:** [#1344](https://github.com/Prism-Shadow/penguin-harness/pull/1344)

[中文版](2026-10-26-unified-retry-row.zh.md)

A machine this server keeps connected now stops retrying after five failed attempts in a row instead of eight, and a person can stop the retries at any point. On the Machines page and in a conversation on that machine, where the reconnect stands takes one line: "Reconnecting in 23 s (attempt 4/5)" while it waits, "Reconnecting (attempt 4/5)" while an attempt runs, with **Retry now** and **Stop retrying** as link-style text on the same line. Why the last attempt failed sits behind a circled "?" after the sentence.

## Server

- A reconnect streak stops after five failed attempts in a row (`reconnect.maxAttempts` is 5). The wait before each attempt doubles from 5 s with no cap of its own.
- `POST /api/projects/:projectId/machines/:machineId/stop-reconnecting` stops a waiting or running streak at once (`reconnect.gaveUp: "cancelled"`, `nextAt: null`), and nothing is tried until a Retry, a Start or a restart of this server. An attempt already under way is not cut off: if it connects, the machine is connected; if it fails, nothing follows it. A machine that is connected, or a streak that already stopped, is left alone. The answer is the machines list, or `404` `unknown_machine`.
- A Retry after stopping an attempt that is still under way takes that attempt as the new streak's first instead of starting a second one. Saving a password for a machine whose stored one was refused tries it once, whether or not its retries were stopped.

## Machines page and conversations

- The retry row in the card's middle, in the Machine dialog's Reconnecting section and in a conversation whose machine is out of reach reads: "Reconnecting in 23 s (attempt 4/5)" with **Retry now** and **Stop retrying**; "Reconnecting (attempt 4/5)" with **Stop retrying**; "Reconnect failed after 5 attempts", "Stopped retrying" or, for an ssh refusal no retry mends, "Reconnect failed; fix ssh first", each with **Retry**; "Sign-in refused; not retrying" with no press. The countdown ticks each second inside the sentence.
- The last failure, or the fix for an ssh refusal or a refused password, is behind the circled "?" after the sentence on the card and in the conversation. The dialog's row has no "?", because the section shows the last failure in full under it, after how long the streak has lasted.
- Where the card's column is narrow, the two presses wrap under the sentence together.

## UI package and gallery

- `RetryStatus` is one row: a mark, the sentence, the "?" for `reason`, and the presses as link-style text. It has a fifth phase, `cancelled` (a muted pause). `gaveUp` now draws the cross in the danger tone. `countdown` returns the whole sentence for the seconds left, `label` is what the row says once the moment has come, and `size` (`xs` / `sm`) replaces `layout`.
- `RetryActions` takes `look`: `button` (the default) keeps the chat's model request retry notice as it was, and `link` is the row's.
- The gallery's Retry topic shows the five phases at both sizes, and the mock API answers the new route.
