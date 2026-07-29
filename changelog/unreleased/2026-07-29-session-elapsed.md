# Web App: the Session's elapsed time is taken from Trace timestamps, so a reload stops restarting it

The elapsed chip in the chat header restarted from zero whenever a running Session was reloaded, and the figure it eventually settled on depended on the browser clock. Both came from the same root: the running Task was the one part of the number not derived from the Trace.

## Reloading mid-run resumes the chip instead of restarting it

The chip renders the settled cross-Task total plus the running Task's wall clock so far, and that second half ticks from a local-clock anchor. A history rebuild feeds every replayed message the same "now", so the anchor was stamped with the instant the page loaded: a Task that had already been running for five minutes was treated as having just started, and the chip dropped back to the settled total and climbed from zero again.

The anchor is now back-dated, once the replay finishes, by the span the Trace already shows, so the ticking value resumes where it left off. Only differences between server timestamps are applied to the local clock, which keeps a client/server clock offset out of the result and lets the chip keep ticking smoothly. A live stream is unaffected: it pushes one message at a time with the real current clock, where that span is still zero when the Task opens.

That back-dated origin is a floor rather than the whole figure, because it reaches the last *recorded* event: while an event is still in flight — a tool executing, a Request streaming, a compaction running — nothing has been appended to the Trace since it began, and a reload landing there would show none of the time it has taken so far. The chip therefore counts from whichever is earlier of that origin and the Task's first message timestamp in server time — the same basis every other running item on the page already ticks from, including running tool and thinking cards and the subagent topology's running nodes. The event in flight is covered, and since the earlier origin is the larger elapsed, a client clock running behind the server's falls back to the skew-free floor rather than shortening the figure.

## A settled round reads the same live and replayed

A round's duration is the span from its first message to its last non-compaction `request_end`. One case escaped that: a round with no `request_end` at all — interrupted before its first Request even ran — was measured with the local clock when it happened to be watched live, and with the message span when it was replayed later. The same round therefore showed one number before a refresh and a different one after, with idle-detection and mid-join latency folded into the first. It now settles to its message span on both paths, which the interrupting abort's own timestamp still bounds.

The local clock now reaches the elapsed figure in exactly one place — animating the Task in flight — and never a settled one. The meaning of the statistic is unchanged: still the sum of each Task's wall clock. Compaction handling is unchanged too, with a mid-round compaction inside the span and a post-round one outside it, and the chat page keeps its deliberate difference from the Trace page's total.
