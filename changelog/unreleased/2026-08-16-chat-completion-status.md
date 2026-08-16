# Web: distinguish running and recently completed chats

Chat activity is now legible without inferring it from a disappearing badge. A running Session
uses a neutral gray spinner in the chat header and sidebar; when an observed run returns to idle,
the spinner becomes a green completion dot with a localized “Done” label. The completion marker is
transient rather than a synonym for `idle`: opening the Session again, starting another run, or
switching Projects clears it, so historical conversations do not accumulate permanent green dots.

Compaction keeps its existing amber treatment, and step-level tool/thinking statuses keep their
existing success/failure icon language. The change is frontend-only and uses the existing
authoritative `task_state` stream.
