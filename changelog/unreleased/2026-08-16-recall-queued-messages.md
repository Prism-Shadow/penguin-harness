# Recall queued steering and follow-up messages into the composer

- **Date:** 2026-08-16
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#321](https://github.com/Prism-Shadow/penguin-harness/pull/321)
- **Issue:** [#287](https://github.com/Prism-Shadow/penguin-harness/issues/287)

[中文版](2026-08-16-recall-queued-messages.zh.md)

A mid-run message that is still waiting — an undelivered steering message, or a follow-up queued behind the current run — can now be recalled back into the input box, edited, and resent. The implementation grew out of the draft [#304](https://github.com/Prism-Shadow/penguin-harness/pull/304) opened by @Myriad-Dreamin.

## Web App

- Every queued hint line above the composer — the undelivered-steering mirror and the new per-entry follow-up list — ends in an icon-only recall control: a curved-back arrow with no label text, drawn at the size and gray the other icon controls on a hint row use, carrying "Recall" as its accessible name and a tooltip saying what it does.
- Clicking it withdraws the message server-side and restores its original content into the draft. The text lands in front of whatever is currently typed, merged against the textarea's live value so keystrokes made while the request is in flight survive, and images and file attachments come back as composer chips (files are read back from the Session scratchpad, whose copies are then deleted). A recalled follow-up also restores the per-turn thinking level it was queued with, and a recall that brings file attachments back releases a staged goal chip, since a goal draft cannot carry files.
- The recall controls are disabled while a send is in flight, and a recall the server refuses surfaces as a toast while the hint retires on its own.
- Every recall re-broadcasts `task_state`, so the hint line disappears in the other tabs too — including the tab that originally sent the message, which drops its local "steering queued" bridge as soon as the server's mirror has arrived.

## Server

- `DELETE /api/sessions/:id/steer/:steerId` and `DELETE /api/sessions/:id/follow-ups/:followUpId` withdraw a waiting message and return its original content `{text, images, files}`, the follow-up's with its `thinkingLevel`.
- The recall handles ride `task_state` events: `pendingSteering` entries gained an `id`, and the new `pendingFollowUps` field lists each queued follow-up's content next to the existing `queued` count. The SSE subscribe snapshot carries `pendingFollowUps` as well, which is what rebuilds the hint lines after a reload.
- A steering message that already reached the model, and a follow-up that already auto-started, answer 409 `not_pending`. A recall landing in the gap between a run going idle and the follow-up drain's locked dequeue wins exactly once, and the drain then starts nothing.

## Core

- `ContextEngine` and `Session` gained `unsteer(input)`, which withdraws a queued steering input, matched by identity, before delivery and refuses once the queue has drained.
