# Hide reasoning in an activity's run log, and copy or expand tool output

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `web`

The Stages panel's live run and the Conversation panel now have a **Show reasoning** switch.
Turning it off leaves the agent's reasoning out of the transcript so only what it did
remains. While the run is still thinking, a **Thinking…** line stands in for the hidden
reasoning. The switch is remembered in this browser and applies to both panels.

- An expanded tool output in either panel has a copy button, which copies the output
  without terminal colour codes.
- An output longer than eight lines also has **Show all**, which shows the whole output
  instead of a short scrolling box, and **Show less** to fold it back.
- The Chat page is unchanged: its transcript still shows reasoning, and its tool cards have
  neither control.
