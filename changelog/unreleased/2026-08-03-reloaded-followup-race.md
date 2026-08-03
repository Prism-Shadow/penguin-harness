# Reloaded follow-ups survive the steering completion race

When a reloaded page still showed a Session as running, the composer first tried the steering endpoint. If the core run ended in that narrow window, `/steer` returned `not_running` and the Web App retried the draft as a plain Task. That second request could arrive before the server runtime completed its own idle transition, return `task_in_progress`, and leave the draft unsent.

The fallback now submits the complete, untouched draft through the existing `queueIfBusy` Task path. The server starts it immediately if the Session is already idle or queues it behind the final part of the old run otherwise. A Playwright regression reloads a Session with a parked Task, forces the stale steering response, and verifies both the accepted queued response and the follow-up's eventual model output.
