# AI Character Chat: a stage where original characters talk with you, with a face and a memory

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`, `docs`
- **PR:** [#1590](https://github.com/Prism-Shadow/penguin-harness/pull/1590)

[中文版](2026-11-17-plugin-character-chat.zh.md)

A new built-in plugin, `character-chat` (AI Character Chat), adds a **Characters** tab beside an Agent's chat and a tile in the App Center. It is not preinstalled: install it onto an Agent from the plugin library.

## Details

- **Character Post.** The desktop view placed the illustrated scene beside the scrolling conversation. On phones the portrait moved above the chat. Switching characters kept the unsent draft. Each starter offered its own opening topics.
- **Characters.** Added Pip the penguin postmaster, Sunny the rooftop weather observer, Ren the night librarian and Mugi the mountain tea maker. Each portrait blinked, changed expression and moved its mouth as the character spoke.
- **A memory book** per character: what it learned about you, one dated line each, with a delete on every line and "forget everything". It is a file of the workbench (`.files/characters/<id>/memory.md`); the newest 120 lines are kept.
- **Friendship** grows with the days you talk, at most a day's worth a day, over five levels; reaching one is said once.
- **The card editor**: names, one-liners, body, colours, what it wears, place, first words and a page of prose, with the portrait redrawn live and ten faces to try. A body is a penguin, a robot, a teapot spirit, a cat or an anime-style person (hairstyle, hair clip or glasses). A card downloads as a `.card.md` file and imports again. "Write it for me" has the Agent write a card from one sentence; a card the Agent writes from the ordinary chat appears in the roster within a second.
- **A Session that only talks.** Each character's conversation is a workbench Session opened with the `deny-all` approval mode ([#1588](https://github.com/Prism-Shadow/penguin-harness/pull/1588)), and its opening message says it has no tools: a line or an imported card cannot make it run anything. A reply you stop leaves your line and no error.
- **The `character-chat` Skill** plays a card in the ordinary chat while still doing real work with tools, writes or imports cards, and tidies a character's memory book when asked.
- Chinese and English, after the device language, with a switch the workbench remembers. Read-aloud uses only voices that run on the device. The page loads nothing from outside the server.
- Listed the plugin under Entertainment.
