# The third-party notices cover the bundled fonts

- **Date:** 2026-09-17
- **Type:** process
- **Scope:** `tooling`
- **PR:** [#770](https://github.com/Prism-Shadow/penguin-harness/pull/770)

[中文版](2026-09-17-notice-misans.zh.md)

`THIRD-PARTY-NOTICES.md` gained an entry for MiSans by Xiaomi, whose Regular and Medium weights the Frost theme ships as `unicode-range` WOFF2 slices. The entry says what subsetting the fonts into slices changes and what it keeps, quotes the copyright notice the font files carry, names `fonts-licenses/misans.txt` as the license text every build ships beside them, and reproduces the full MiSans Font Intellectual Property License Agreement in Chinese and English. The file also gained an entry for each of the six SIL Open Font License 1.1 faces in the web assets (Mona Sans, JetBrains Mono, IBM Plex Sans, IBM Plex Sans Condensed, Commit Mono and Noto Sans SC), and its introduction now says that the fonts also ship through npm, in the `@prismshadow/penguin-server` package's `web-dist/`.
