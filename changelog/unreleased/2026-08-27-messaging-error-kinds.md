# A messaging refusal the chat already explained is no longer counted as a defect

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`

[中文版](2026-08-27-messaging-error-kinds.zh.md)

Every failure the messaging bridge caught was written to `error_records` without a `kind`, and the
recorder's default for a non-HTTP source is `unexpected`. So two things that are neither surprising
nor anyone's bug were filed as "shouldn't happen, needs a human":

- a Feishu app that has not been granted `im:message` / `im:message.history:readonly` yet, whose
  refusal (code 99991672) already reaches the chat complete with the scope names and the console
  link to grant them;
- a file sent to QQ, which the platform can only accept behind a publicly reachable https URL that
  this server has no way to provide — a refusal it will repeat identically every time.

Both are now `expected`. The recorder's criterion is **"does a human need to step in"**, and in both
cases the answer is no: the one person who can act has already been handed the fix in the chat, or
there is no fix to apply.

## Details

- `runtime/messaging/error-kind.ts` holds the rule, with the reasoning for each case. It is a small
  allowlist of TYPED failures, not a message match: anything the connectors have not classified
  stays `unexpected`, which is the safe direction — a real fault miscounted as routine is invisible,
  while routine noise miscounted as a fault is merely loud. Classifying by type rather than wording
  also keeps the count from depending on how a platform phrases its refusal.
- Three failures are expected: `MessagingPermissionError` (a scope to grant, already named in the
  chat), `MessagingMediaTooLargeError` (the sender fixes it by sending something smaller) and the
  new `MessagingUnsupportedError` (the channel structurally cannot carry it). QQ's outbound media
  refusal now throws the last of these instead of a bare `Error`.
- A send the channel refused — a rate limit dropping a line of an answer — stays `unexpected`: that
  loses content and tells nobody, which is the opposite of a refusal the chat explains.
- The records themselves are unchanged in every other respect, including still being recorded at
  all: a scope nobody grants is still worth finding on the dashboard, it is simply not a defect.

## Compatibility

Error records already written keep the classification they were written with — nothing rewrites
history. A Feishu scope denial recorded before this change stays `unexpected` until it ages out of
the view, so an existing "unexpected errors" count does not drop on upgrade.
