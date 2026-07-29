# Web App: the Session's elapsed time is taken from Trace timestamps, so a reload stops restarting it

The elapsed chip in the chat header restarted from zero whenever a running Session was reloaded, and the figure it eventually settled on depended on the browser clock. Both came from the same root: the running Task was the one part of the number not derived from the Trace.

## Reloading mid-run resumes the chip instead of restarting it

The chip renders the settled cross-Task total plus the running Task's wall clock so far, and that second half ticks from a local-clock anchor. A history rebuild feeds every replayed message the same "now", so the anchor was stamped with the instant the page loaded: a Task that had already been running for five minutes was treated as having just started, and the chip dropped back to the settled total and climbed from zero again.

The anchor is now back-dated, once the replay finishes, by the elapsed already behind the Task, so the ticking value resumes where it left off. That elapsed is measured entirely in server time and only then applied to the local clock, which keeps a client/server clock offset out of the result and lets the chip keep ticking smoothly. A live stream is unaffected: it pushes one message at a time with the real current clock, where the elapsed is still zero when the Task opens.

It is measured against the server's own clock at read time, taken from the messages response's HTTP `Date` header, rather than against the Trace's last entry. That distinction is what makes an event still in flight count: while a tool is executing, a Request is streaming or a compaction is running, nothing has been appended to the Trace since it began, so a reload measuring only what the Trace records would show none of the time that event has already taken. The Trace's own span remains the floor — it is the fallback when no `Date` header comes back, and a cached or rewritten header can only be older than the true present, so it can under-report but never overshoot. The header carries whole seconds, which is finer than a chip that ticks in whole seconds can show.

## A settled round reads the same live and replayed

A round's duration is the span from its first message to its last non-compaction `request_end`. One case escaped that: a round with no `request_end` at all — interrupted before its first Request even ran — was measured with the local clock when it happened to be watched live, and with the message span when it was replayed later. The same round therefore showed one number before a refresh and a different one after, with idle-detection and mid-join latency folded into the first. It now settles to its message span on both paths, which the interrupting abort's own timestamp still bounds.

The local clock now reaches the elapsed figure in exactly one place — animating the Task in flight — and never a settled one. The meaning of the statistic is unchanged: still the sum of each Task's wall clock. Compaction handling is unchanged too, with a mid-round compaction inside the span and a post-round one outside it, and the chat page keeps its deliberate difference from the Trace page's total.
