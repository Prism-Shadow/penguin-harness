# A dropped QQ gateway stops counting as a defect, and the error table gains a clear action

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#530](https://github.com/Prism-Shadow/penguin-harness/pull/530)

[中文版](2026-08-28-error-noise-and-clear.zh.md)

Two changes to the cost center's error panel. A QQ gateway connection that the platform closed
and the connector brought straight back no longer files as an error needing a human, and a
Project owner can empty the table the panel is showing.

## Gateway closes are classified by what the connector does next

The QQ gateway session now reports a close as a typed `MessagingConnectionClosedError`, carrying
the platform's close code and whether the next handshake restores the connection with nothing
changed. `error-kind.ts` reads that verdict — never the message text, so the count does not
depend on how a platform words its own close. One outage still reports once, with one
exception: a routine close does not keep the slot, so an expired socket followed by a refusal
that repeats forever still records the refusal.

- `expected`: close code 4009 (the platform expiring a long-lived connection, which stays
  resumable, so the session replays from its sequence number) and the 4900–4913 internal-error
  band, whose documented handling is the re-identify the session already performs.
- `unexpected`, unchanged: 4006 and 4007, where only a fresh identify recovers and whatever
  arrived in the gap is lost; 4004, 4014 and every other refusal that repeats identically until
  a credential or a console setting changes; 4914 and 4915, where the session stops for good;
  and the failures that are not platform closes at all — a handshake that never completed, a
  gateway that stopped acknowledging heartbeats.

Records already stored keep the `kind` they were written with; the classification applies to
errors recorded from here on.

## Clearing the error table

`DELETE /api/projects/:projectId/usage/errors` empties the table for the filter the panel is
showing, and the panel's footer offers it behind a confirmation.

- **Scope**: the date range and Agent the panel actually read, the same window its rows and its
  later pages come from — the trailing presets compute theirs at load time rather than from the
  date pair the picker holds, so the clear follows what is on screen rather than what was picked
  before it. Rows outside it are kept, and the confirmation states the range, the Agent when one
  is selected, and how many rows will go. It is offered only where both bounds are real dates,
  since an open-ended range is wider than the sentence can promise.
- **Authorization**: Project owner only, the rule Agent deletion already applies to error rows.
  A member can read the panel and gets 403 on the delete; the panel does not show the action to
  one.
- Errors with no Project attribution — login failures, process crashes — are outside every
  clear, whoever asks. They belong to no Project and appear in every Project's admin view, so
  the delete's reach stays strictly narrower than any caller's read. The dashboard's error block
  gained a `clearable` count for exactly this: an admin's read includes those rows and the
  confirmation must not, or it would promise a number larger than what goes.
- `ErrorsRepo.deleteFiltered` builds its `WHERE` from the same clause the reads use, so a
  clear cannot select a row a matching read would not have returned.

Deleted rows are gone: an error record has no copy anywhere else, and nothing restores it.
