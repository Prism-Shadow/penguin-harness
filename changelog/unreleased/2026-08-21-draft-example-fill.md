# Home-screen examples fill the composer instead of sending

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#398](https://github.com/Prism-Shadow/penguin-harness/pull/398)

[中文版](2026-08-21-draft-example-fill.zh.md)

Clicking an example on the new-chat screen used to create the Session and submit the canned prompt on the spot. It now fills the composer and stops: the prompt lands in the text body, the example's skills are preselected in the skills dropdown, and the user presses Send — which builds exactly the message the card used to submit by itself.

## Details

- The prompt goes into the textarea as plain text. The `[use_skills]` block is still assembled at send time, so the visible draft stays editable rather than showing a marker block.
- The example's skills are preselected only when the selected Agent has them installed, and they join whatever was already selected instead of replacing it.
- The prompt takes the text body outright: a typed-but-unsent draft is cleared first, so the box holds the example and nothing else, and clicking through several examples never stacks one canned prompt behind another. Skills are the exception and stay additive — the selection cannot tell an example's pin from a choice the user made, while the text body carries no such ambiguity.
- The composer takes focus with the caret at the top of the prompt and the textarea scrolled there — a long prompt no longer arrives showing only its last line.
- The per-card loading spinner is gone, along with the disabled states that only guarded submission. A row still waits for the Agent's installed skills, without which the skill preselect would silently drop the example's skills.
- Each row's tooltip gains a second line saying the click fills the composer, in both languages.
