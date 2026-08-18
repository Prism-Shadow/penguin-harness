# Recall queued steering and follow-up messages back into the composer

A mid-run message that is still waiting — an undelivered steering message, or a follow-up
queued behind the current run — can now be recalled back into the input box, edited, and
resent (#287).

Details:

- Every queued hint line above the composer (the undelivered-steering mirror and the new
  per-entry follow-up list) carries a **Recall** button. Clicking it withdraws the message
  server-side and restores its original content into the draft: the text lands in front of
  whatever is currently typed, and images/file attachments come back as composer chips
  (files are read back from the Session scratchpad, whose copies are then deleted). A
  recalled follow-up also restores the per-turn thinking level it was queued with, and a
  recall that brings file attachments back releases a staged goal chip (a goal draft cannot
  carry files).
- New endpoints: `DELETE /api/sessions/:id/steer/:steerId` and
  `DELETE /api/sessions/:id/follow-ups/:followUpId`, both returning the withdrawn message's
  original content `{text, images, files}`. The recall handles ride `task_state` events:
  `pendingSteering` entries gained an `id`, and the new `pendingFollowUps` field lists each
  queued follow-up's content next to the existing `queued` count.
- A steering message that was already delivered to the model — and a follow-up that already
  auto-started — answers 409 `not_pending`: there is nothing left to take back, and the web
  app surfaces that as a toast while the hint retires on its own.
- Core: `ContextEngine`/`Session` gained `unsteer(input)`, withdrawing a queued steering
  input (matched by identity) before delivery; it refuses once the queue drained, which is
  what makes the recall race-safe against delivery.
