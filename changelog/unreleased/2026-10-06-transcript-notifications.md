# A question card and a retry reach the system notification centre

- **Date:** 2026-10-06
- **Type:** feature
- **Scope:** `web`, `desktop`
- **PR:** [#992](https://github.com/Prism-Shadow/penguin-harness/pull/992)
- **Issue:** [#991](https://github.com/Prism-Shadow/penguin-harness/issues/991)

[中文版](2026-10-06-transcript-notifications.zh.md)

Two more things now interrupt the user through the operating system, and the three that do share
one switch, one set of gates and one code path: a Task finishing (already shipped), a question card
arriving in the open Session, and a dropped request starting to retry.

## Details

- **`lib/system-notify.ts` is the one place this app constructs a `new Notification`**, and it
  holds the three gates every announcement passes in the same order: the user asked for
  notifications (off until they turn it on), the platform grants permission *at this moment* (an OS
  can revoke it while the app runs, and a revoked permission must not be read as "show it anyway"),
  and the window is out of the way. A caller that forgot one of them would not fail loudly — it
  would quietly announce something into a window the user is looking at, which is exactly why they
  are not the caller's business. `state/use-completion-notifications.ts` was rewritten onto this
  presenter; its own remaining job is reading the transition out of the Session list, which covers
  every Session rather than only the one on screen.
- **Settings › General's one switch covers all of them.** Its label changed from "task-completion
  notifications" to "系统通知 / System notifications", and the row's explanatory copy now says what
  it covers. A fourth kind of announcement cannot invent a fourth answer to "may I interrupt this
  person".
- **A question card arriving in the open Session notifies** with the card count
  (`「<session>」有 N 个问题待回答，点击查看`); clicking focuses the window, navigates to that
  Session and scrolls the newest unanswered card into view with a ring flash (`.ask-card-flash` in
  `styles.css`, applied through `classList` so a re-render during streaming cannot strip it
  mid-animation). Cards left over from history do not fire: the trackers reset while the transcript
  loads, so the first complete snapshot is the baseline.
- **A retry ladder starting to wait notifies** with the attempt ordinal and the wait the engine
  announced, when it announced one (`「<session>」第 N 次重试，M 秒后发起`); the wording survives
  without a countdown. The click has nowhere special to go — the reconnect line is the last thing
  the live tail renders — so it only opens the Session.
- **Every snapshot is fed to both trackers before any gate runs**, so a question or a retry the user
  watched arrive in a focused window is consumed silently rather than announced on a later blur.
- **One notification per Session, per kind.** Notices are tagged (`penguin-ask-<sessionId>`,
  `penguin-retry-<sessionId>`, `penguin-task-<sessionId>`), so a newer one replaces the stale one in
  the notification centre instead of stacking up beside it.
- **The desktop window keeps rendering while it is minimized or covered**
  (`backgroundThrottling: false`). Chromium pauses animation frames and throttles timers for a
  hidden page, and this app does its work in the renderer: a transcript that streams in while the
  window is minimized would not commit, and every one of these hooks reads what is rendered — so
  "the task finished" or "a question is waiting" has to reach the user precisely while they are
  elsewhere.
- **The scope is the open Session, and that is deliberate.** A question asked in a Session that is
  not on screen arrives unannounced, and is simply there when the user next opens it; closing that
  gap means the server telling the client that a Session has an unanswered card, which is a protocol
  change this client-side feature does not make. Task *completions* have no such limit, because
  their tracker reads the tracked Session list. `test/ask-notify.test.ts` and
  `test/retry-notify.test.ts` cover the two trackers.
