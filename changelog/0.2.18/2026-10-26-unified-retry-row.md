# One retry row for machine reconnects and model request retries; reconnects stop after five attempts and can be stopped

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui`, `ui-gallery`, `docs`
- **PR:** [#1344](https://github.com/Prism-Shadow/penguin-harness/pull/1344)

[中文版](2026-10-26-unified-retry-row.zh.md)

A machine this server keeps connected now gives up after five failed attempts in a row instead of eight, waits longer before its first attempt, and a person can stop the retries at any point. On the Machines page, in a conversation on that machine, and on the line of a model request being retried, where things stand takes one row: "Reconnecting in 23 s (attempt 4/5)" or "Retrying in 23 s (attempt 3/10)" while it waits, with **Retry now** and **Stop retrying** as link-style text on the same line. Why it failed sits behind a circled "?" after the sentence.

## Server

- A reconnect streak stops after five failed attempts in a row (`reconnect.maxAttempts` is 5). The first wait after a machine is lost is 15 s, and each failed attempt doubles it, with no cap of its own. How soon a machine that a job is working on is looked at again is unchanged.
- `POST /api/projects/:projectId/machines/:machineId/stop-reconnecting` stops a waiting or running streak at once (`reconnect.gaveUp: "cancelled"`, `nextAt: null`), and nothing is tried until a Retry, a Start or a restart of this server. An attempt already under way is not cut off: if it connects, the machine is connected; if it fails, nothing follows it. A machine that is connected, or a streak that already stopped, is left alone. The answer is the machines list, or `404` `unknown_machine`.
- A Retry after stopping an attempt that is still under way takes that attempt as the new streak's first instead of starting a second one. Saving a password for a machine whose stored one was refused tries it once, whether or not its retries were stopped.

## Core

- `DEFAULT_MAX_TURN_ATTEMPTS` (10, the engine's default ceiling on a turn's attempts, the first request included) is exported from `@prismshadow/penguin-core/interfaces`, so a host numbering the retries shows the engine's own ceiling.

## Machines page and conversations

- The retry row in the card's middle, in the Machine dialog's Reconnecting section and in a conversation whose machine is out of reach reads: "Reconnecting in 23 s (attempt 4/5)" with **Retry now** and **Stop retrying**; "Reconnecting (attempt 4/5)" with **Stop retrying**; "Reconnect failed after 5 attempts", "Stopped retrying" or, for an ssh refusal no retry mends, "Reconnect failed; fix ssh first", each with **Retry**; "Sign-in refused; not retrying" with no press. The countdown ticks each second inside the sentence.
- The last failure is behind the circled "?" after the sentence on the card and in the conversation, under the title "Last failure"; for an ssh refusal or a refused password the "?" holds the fix. The dialog's row has no "?", because the section shows the last failure in full under it, after how long the streak has lasted.
- A machine whose reconnects failed — after five attempts, or at an ssh refusal no retry mends — wears a new status pill, "Reconnect failed", in the danger tone of its row's cross, on its card and in its dialog. "Reconnect stopped" now means a person stopped retrying, in the attention tone of its row's pause mark.
- Where the card's column is narrow, the two presses wrap under the sentence together.

## Model request retries

- The line a retried model request leaves in a conversation is the same row: "Retrying in 23 s (attempt 3/10)" with **Retry now** and **Stop retrying** while the wait counts down, "Retrying (attempt 3/10)" as the request goes out, "Retried (attempt 3/10)" once it went out, and "Request failed after 6 attempts" with **Retry** when the run ended there. The attempt counts every request of the turn, the first one included, out of the engine's ceiling. What the presses do is unchanged; **Give up** is now **Stop retrying**.
- The cause and the provider's message are behind the "?" instead of in the line.

## UI package and gallery

- `RetryStatus` is one row: a mark, the sentence, the "?" for `reason` (with an optional `reasonTitle` as the panel's first line), and the presses as link-style text. It has the phases `cancelled` (a pause in the attention tone) and `retried` (a turning arrow, muted); `gaveUp` draws the cross in the danger tone. `countdown` returns the whole sentence for the seconds left, `label` is what the row says once the moment has come, and `size` (`xs` / `sm`) replaces `layout`. `RetryActions` always draws link-style presses.
- `MachineStatusPill` has the `reconnectFailed` state (danger).
- A new theme token, `--ui-link-decoration`, sets a link-style button's line at rest: `none` in Primer and Frost, `underline` in Console, whose link ink is the body's. Console's link buttons are now underlined at rest everywhere.
- The gallery's Retry topic shows the machine phases at both sizes and a model request's retry in its four states. The mock API answers the new route.
