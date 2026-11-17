# Two built-in workbench apps: Kaoyan Flashcards and Perler Studio

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`, `server`, `docs`
- **PR:** [#1586](https://github.com/Prism-Shadow/penguin-harness/pull/1586)

[中文版](2026-11-17-kaoyan-perler-workbenches.zh.md)

The plugin library ships two app-only plugins, `kaoyan-flashcards` (Kaoyan Flashcards, 考研记忆卡) and `perler-studio` (Perler Studio, 拼豆创作工作台). Neither carries a Skill and neither is preinstalled: an Agent gets one when it is installed from the library, and the app then opens beside the chat and from the App Center.

## Details

- Kaoyan Flashcards is a question bank for China's postgraduate entrance exam: 295 sample cards in six subjects with spaced review, a wrong-answer book and stars, nine recitation documents with marking and masking, import of `.docx`, `.pdf`, `.txt` or `.md` files or pasted text into cards and documents, and a JSON backup. The bank is `ui/data/decks.json`, one card per line, so the Agent can add a deck when asked.
- Perler Studio turns a picture into a perler-bead pattern of 29 to 104 cells a side, or any size from 4 to 200. It recommends the settings with a reason for each, matches every cell by perceptual colour difference (CIEDE2000) against a built-in palette or one the user imports, and exports a PNG pattern, a CSV, JSON and an A4 print page. Its basic 29-colour palette, 「基础 29 色（参照 Hama 色号）」, numbers its colours after Hama's chart, and the app says it is not affiliated with that brand.
- Both apps show a Chinese or an English interface after the device language; a switch in the top bar changes it in place and remembers the choice. Exam cards and recitation notes stay in Chinese.
- Progress and settings are kept in the workbench's own state, separately for each Agent, so they follow the Agent from one browser to another; uninstalling the plugin deletes them. Neither app contacts any host other than its own server.
- The server's library test counts a workbench as a plugin's part, beside a Skill or a hook package.
