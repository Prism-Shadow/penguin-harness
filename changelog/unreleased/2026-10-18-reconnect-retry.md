# Machine reconnects stop at a stated point and offer Retry; one retry status in the UI package

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `docs`
- **PR:** [#1204](https://github.com/Prism-Shadow/penguin-harness/pull/1204)

[中文版](2026-10-18-reconnect-retry.zh.md)

A machine the server keeps connected was retried forever, every five minutes once the backoff reached its cap, and the Machines page neither said when the next try would come nor offered one now. The automatic attempts now stop after eight failures in a row (about fifteen minutes), or at the first ssh refusal that no retry mends, and the machine's card and its dialog show where the streak stands with a Retry. The retry status is one component in the shared UI package; the chat's reconnect notice takes its countdown and buttons from it too.

## Server

- A reconnect streak stops after eight failed attempts in a row (`reconnect.gaveUp: "attempts"`, `nextAt: null`), and the minute look-over leaves a stopped machine alone. A restart of the server begins every streak again.
- An ssh failure that retrying cannot fix — a host key unknown or changed, an unusable key file, a refused key, a broken ssh config — stops the streak at its first failure (`gaveUp: "ssh"`), without a connection check.
- `MachineReconnect` gained `maxAttempts` and `gaveUp`.
- `POST /api/projects/:projectId/machines/:machineId/reconnect` runs an attempt at once: a waiting streak skips the rest of its wait and keeps its count, a stopped one starts again from the first attempt, and an attempt already running or a connected machine is left alone. It answers the machines list, or `409` `job_running`, `password_refused` or `not_kept_connected`, or `404` `unknown_machine`.

## Machines page

- The card's middle and the dialog's Reconnecting section show the retry status: "Trying to reconnect (4 of 8)…"; "Reconnect 3 of 8 failed · next try in 80 s" with Retry now; "Stopped retrying after 8 failed reconnects" with the last failure and Retry; an ssh refusal no retry mends with its fix and Retry; a refused password with its fix and no Retry. The countdown ticks each second.
- The status pill has a new word, "Reconnect stopped" (attention), for a stopped streak; "Sign-in refused" stays for a refused password. The card no longer says how long the streak has lasted; the dialog does.
- The new-chat Agent picker and Agent settings say "That machine stopped reconnecting — retry it from the Machines page" for a stopped streak.
- A refused Retry is said in the page's notice in the reader's language, and the button can be pressed again.

## UI package and gallery

- `RetryStatus` (phases `trying`, `waiting`, `gaveUp` and `blocked`, as a card's `line` or a dialog's `block`), `RetryActions` (the button pair; a press holds both until the next attempt begins, and a refused request releases them), `useCountdown` and `countdownSeconds`. `MachineCard` takes a `retry` status for its middle, and `MachineStatusPill` has the `reconnectStopped` state.
- The chat's reconnect notice takes its countdown and its Retry now and Give up buttons from them; what it says and does is unchanged.
- The gallery has a Retry topic with every phase in both layouts, in a machine card, in a chat notice and at phone width; the Machines topic shows a stopped card.
