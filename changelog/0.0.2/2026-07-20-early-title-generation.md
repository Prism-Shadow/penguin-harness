# Start title generation after 1000 chars of body text

Session titles start generating as soon as ~1000 characters of main-session body text have
streamed, instead of waiting for the whole Task to finish — long answers no longer overrun
the title material — and the title prompt now suppresses chain-of-thought.

## Details

- Server: the output relay fires the title generator mid-run once EARLY_TITLE_BODY_CHARS
  (1000) of main-session complete body text have streamed (sub-session text doesn't count);
  the generator self-guards (NULL title, single flight), and the Task-completion trigger
  stays as the short-answer fallback. Covered by a gated mid-run test proving the early
  fire happens while the run is still in flight.
- Core: the captured assistant-side title material is capped at 1000 chars (the user side
  keeps 2000) — a title only needs the opening of the answer.
- The title prompt adds an explicit "answer immediately — do not think aloud or produce
  chain-of-thought" rule and ends with an empty `<think></think>` block, which many
  reasoning models treat as an already-closed thinking phase (same trick as the model
  probe), keeping the one-off request's budget on the title itself.
