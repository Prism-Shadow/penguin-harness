# Web: distinguish running and completed chats by icon shape

Chat activity is now legible without inferring it from a disappearing badge, and the states are
told apart by icon SHAPE rather than color alone (color stays as a secondary cue, so the glyphs
also work without color vision). A running Session shows a pulsing gray hourglass in the chat
header and sidebar; when an observed run returns to idle, it becomes a green circled checkmark
with a localized “Done” label. A compacting Session shows an amber inward-collapsing chevron
glyph in the sidebar (the chat page keeps compaction in its stream banner). Every glyph carries
its localized label as tooltip and accessible name.

The completion marker is transient rather than a synonym for `idle`: opening the Session again,
starting another run, or switching Projects clears it, so historical conversations do not
accumulate permanent checkmarks.

The hourglass and circled check reuse the step-level status icons' shape vocabulary; step-level
tool/thinking statuses themselves are unchanged. The change is frontend-only and uses the
existing authoritative `task_state` stream.
