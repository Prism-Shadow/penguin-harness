# Queued follow-ups are recallable however they were queued

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#485](https://github.com/Prism-Shadow/penguin-harness/pull/485)

[中文版](2026-08-27-follow-up-recall.zh.md)

A message sent to a busy Session from a bound chat channel joined the follow-up queue without
the content a recall hands back, so the Web App drew its queued line empty and its recall
button answered "this message already went out" while the message was still waiting. The
queue now keeps that content for every entry, and the two recall endpoints stopped sharing one
error code.

## Details

- `startTask` derives a queued follow-up's recall content from the input when the caller
  supplies none, so a follow-up queued straight through the manager — the path the messaging
  bridge takes for Feishu and Telegram — carries its text and inline images like one posted
  over HTTP. The queued line in the composer shows what is waiting, and its recall button
  withdraws it.
- `DELETE /api/sessions/:id/follow-ups/:followUpId` refuses only ids that are no longer in the
  queue, and refuses them as 409 `follow_up_started`. `DELETE /steer/:steerId` keeps
  `not_pending` for a steering message the model already received.
- The Web App's error copy split with the codes: a recalled-too-late follow-up reads "This
  follow-up already started and can no longer be recalled", a recalled-too-late steering
  message "This steering message already reached the model and can no longer be recalled".
