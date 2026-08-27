# A messaging refusal the chat already explained is no longer counted as a defect

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#511](https://github.com/Prism-Shadow/penguin-harness/pull/511)

[中文版](2026-08-27-messaging-error-kinds.zh.md)

Every failure the messaging bridge caught was written to `error_records` without a `kind`, and the
recorder's default for a non-HTTP source is `unexpected`. So two things that are neither surprising
nor anyone's bug were filed as "shouldn't happen, needs a human":

- a Feishu app that has not been granted `im:message` / `im:message.history:readonly` yet, whose
  refusal (code 99991672) already reaches the chat complete with the scope names and the console
  link to grant them;
- a file sent to QQ, which the platform can only accept behind a publicly reachable https URL that
  this server has no way to provide — a refusal it will repeat identically every time.

Both became `expected`. The recorder's criterion is **"does a human need to step in"**, and in both
cases the answer is no: the one person who can act has already been handed the fix in the chat, or
there is no fix to apply.

## Details

- `runtime/messaging/error-kind.ts` was added to carry the rule, with the reasoning for each case
  written beside it. It was built as a small allowlist of TYPED failures at NAMED capture points
  rather than a message match: anything the connectors had not classified was left `unexpected`,
  which is the safe direction — a real fault miscounted as routine is invisible, while routine
  noise miscounted as a fault is merely loud. Deciding by type rather than by wording also keeps
  the count from depending on how a platform phrases its refusal.
- Three failure types were allowed through: `MessagingPermissionError` (a scope to grant, already
  named in the chat), `MessagingMediaTooLargeError` (the sender fixes it by sending something
  smaller) and the new `MessagingUnsupportedError` (the channel structurally cannot carry it).
  QQ's outbound media refusal was changed to throw the last of these instead of a bare `Error`.
- The capture point counts as much as the type, because Feishu throws the same scope denial from
  every call it makes. Only the inbound image download and the outbound file upload answer that
  refusal with a notice in the chat, so only those two were allowed to file it as `expected`. A
  send, an inbound message whose Task never started and a connection that never came up were left
  `unexpected` whatever they threw: the chat hears nothing there, and an app granted the receive
  scopes but not `im:message:send_as_bot` would otherwise take every question and answer none of
  them without raising anything anywhere.
- The records were left unchanged in every other respect, including still being written at all: a
  scope nobody grants is still worth finding on the dashboard, it is simply not a defect.

## Compatibility

Error records already written keep the classification they were written with — nothing rewrites
history. A Feishu scope denial recorded before this change stays `unexpected` until it ages out of
the view, so an existing "unexpected errors" count does not drop on upgrade.
