# Two built-in workbench apps: English Learning Workbench and Piggy Sticker World

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`, `server`, `docs`
- **PR:** [#1587](https://github.com/Prism-Shadow/penguin-harness/pull/1587)

[中文版](2026-11-17-english-piglet-workbenches.zh.md)

The plugin library ships two more app-only plugins, `english-workbench` (English Learning Workbench, 英语学习工作台) and `piglet-stickers` (Piggy Sticker World, 猪猪的摸鱼小世界). Neither carries a Skill and neither is preinstalled: an Agent gets one when it is installed from the library, and the app then opens beside the chat and from the App Center.

## Details

- English Learning Workbench reads three public-domain classics (Austen, Conan Doyle, Shelley) aloud sentence by sentence with word highlighting, annotated words, a Chinese parallel text and two-page spreads; guides three news stories and a TED talk through a link, a summary, annotated words and a question, with a box to paste the text in; reads any pasted article the same way; keeps a word and sentence library with spaced review; and adds shadowing with a local recording, exam drills, a daily plan and exports of the record.
- Its learning record is one document in the workbench's own state, with no account and no file access. The daily press page contacts nothing until the learner switches it on; the server then reads only a fixed list of public feeds (`feeds.npr.org`, `feeds.a.dj.com`, `www.latimes.com`, `www.wired.com`, `www.smithsonianmag.com`, `www.sciencedaily.com`, `www.nature.com`) under its own `User-Agent`, and an article is studied by pasting its text, never by fetching its page.
- Piggy Sticker World is a sticker-scene game: 208 stickers on 13 scenes, 10 themed levels, daily goals, blind boxes and saved works exported as PNG. Its piglet is a new, original emoji-style character drawn in SVG, in every pose and expression the game uses, and level 8 is named 「月亮下的加餐时间」 (Moonlight Snack Time).
- Both apps show a Chinese or an English interface after the device language; a switch changes it in place and remembers the choice. English Learning Workbench translates its interface and help; the English it teaches stays as written.
- Progress is kept in the workbench's own state, separately for each Agent, so it follows the Agent from one browser to another; uninstalling the plugin deletes it.
- The server's library test counts a workbench as a plugin's part, beside a Skill or a hook package.
