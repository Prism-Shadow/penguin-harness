# Console reads in IBM Plex Sans and sets code in JetBrains Mono

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#894](https://github.com/Prism-Shadow/penguin-harness/pull/894)

[中文版](2026-09-30-console-typeface.zh.md)

Console (极客) had set its whole interface in Commit Mono (navigation, buttons, labels, headings and settings) and kept IBM Plex Sans for message text, the composer and Session titles. Following the owner's decision, IBM Plex Sans became Console's main face everywhere, and JetBrains Mono replaced Commit Mono as its monospaced face. Console's colours, text sizes, spacing and square shapes stayed as they were.

## Details

- Navigation, buttons, labels, settings, headings and page titles took IBM Plex Sans, with Noto Sans SC for Chinese as before. The selected navigation row is still marked in bold.
- Monospace stayed only on code and on deliberately technical marks, all now set in JetBrains Mono: code blocks and inline code, a notice's status tag (`[ OK ]`, `[WARN]`, `[FAIL]`, `[INFO]`, `[NOTE]`), the uppercase label and the block progress bar of a step in the agent's work, and chart axis labels. A step's duration and step count stay monospaced; the description beside a tool step took the sans, as in the other themes.
- **Fonts** in Settings → Appearance: a chosen Latin face now changes Console's whole interface, as it does under Primer and Frost. Before, it changed only Console's reading text.
- Commit Mono is no longer bundled. Its font files, its licence text and its entry on the Credits page were removed, so a build is about 95 KB smaller. JetBrains Mono was already bundled for Primer and Frost, so no font was added, and the Credits page lists Console among the themes that use it.
- The gallery's Fonts (字体) page shows JetBrains Mono in Console's row of the default-faces table.
