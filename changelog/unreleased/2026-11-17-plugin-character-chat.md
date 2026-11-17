# AI Character Chat: a stage where original characters talk with you, with a face and a memory

- **Date:** 2026-11-17
- **Type:** feat
- **Scope:** `plugins`, `docs`
- **PR:** [#1590](https://github.com/Prism-Shadow/penguin-harness/pull/1590)

[中文版](2026-11-17-plugin-character-chat.zh.md)

A new built-in plugin, `character-chat` (AI Character Chat), adds a **Characters** tab beside an Agent's chat and a tile in the App Center. It is not preinstalled: install it onto an Agent from the plugin library.

## Details

- **The stage.** A character stands in a scene lit by your own clock (day, dusk, night) and talks in one dialogue box. Its face changes with what it says, before the words arrive; it blinks, breathes and moves its mouth while a reply streams, and a reply can end with up to three things you might say next. The first words of a first meeting are typed out. After six hours away a character naps until you speak.
- **Four original characters**: Pip, a penguin postmaster; Tock, a clockwork night librarian; Steep, a teapot spirit; and Sunny, a girl drawn in the anime way who keeps a rooftop weather station. All are friends, not partners, and say they are played by an AI when asked.
- **A memory book** per character: what it learned about you, one dated line each, with a delete on every line and "forget everything". It is a file of the workbench (`.files/characters/<id>/memory.md`); the newest 120 lines are kept.
- **Friendship** grows with the days you talk, at most a day's worth a day, over five levels; reaching one is said once.
- **The card editor**: names, one-liners, body, colours, what it wears, place, first words and a page of prose, with the portrait redrawn live and ten faces to try. A body is a penguin, a robot, a teapot spirit, a cat or an anime-style person (hairstyle, hair clip or glasses). A card downloads as a `.card.md` file and imports again. "Write it for me" has the Agent write a card from one sentence; a card the Agent writes from the ordinary chat appears in the roster within a second.
- **A Session that only talks.** Each character's conversation is a workbench Session opened with the `deny-all` approval mode ([#1588](https://github.com/Prism-Shadow/penguin-harness/pull/1588)), and its opening message says it has no tools: a line or an imported card cannot make it run anything. A reply you stop leaves your line and no error.
- **The `character-chat` Skill** plays a card in the ordinary chat while still doing real work with tools, writes or imports cards, and tidies a character's memory book when asked.
- Chinese and English, after the device language, with a switch the workbench remembers. Read-aloud uses only voices that run on the device. The page loads nothing from outside the server.
- The plugin is listed under Office Productivity until the Learning and Life category exists.
