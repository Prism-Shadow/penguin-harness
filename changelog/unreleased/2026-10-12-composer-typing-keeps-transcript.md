# Typing in the composer no longer moves the conversation

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1052](https://github.com/Prism-Shadow/penguin-harness/pull/1052)

[中文版](2026-10-12-composer-typing-keeps-transcript.zh.md)

The composer sized its text box on every keystroke by collapsing it to `height: auto` and reading its content height. That read laid the page out with the composer shorter, so the message list above it, sized by what the composer leaves, grew for that moment, and the browser clamped a list parked at the bottom to the taller viewport's bottom. Restoring the height did not give the offset back.

- With a draft of one or two lines the list slid by a device pixel at some theme and text-size combinations, for example Frost at text size L on a 2× screen. While a reply streamed, each update snapped it back to the bottom and the next keystroke slid it again, so the list shook as the user typed.
- With a draft of three lines or more the first keystroke scrolled the list back by the extra lines, and auto-follow read the jump as the user scrolling away, so a streaming reply stopped scrolling into view and the jump-to-latest button appeared.
- The box is still collapsed and measured, but its parent is held at its current height while that happens, so nothing outside the composer moves. The same fix applies to the company channel composer.
