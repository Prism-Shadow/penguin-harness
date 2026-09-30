# Primer, the default theme, takes GitHub Primer's typefaces

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-primer-typeface.zh.md)

Primer (通用), the default theme, had set its text in the platform's system fonts. It switched to the typefaces GitHub Primer uses: Mona Sans for Latin text, JetBrains Mono for code and Noto Sans SC as its CJK face, each placed ahead of the system fonts it used before, which stay behind them as the fallback. Primer's text sizes and spacing stayed as they were. Its grays changed separately, in [Primer's blacks, whites and grays become pure neutral](2026-09-30-primer-neutral-grays.md).

## Details

- The interface, reading text and headings took Mona Sans; code blocks, inline code and other monospaced text took JetBrains Mono; the CJK face became Noto Sans SC, ahead of PingFang SC and Microsoft YaHei.
- All three faces were already bundled — Mona Sans for the font pairing, JetBrains Mono for Frost, Noto Sans SC for Console — so the build gained no font files. A Primer session began downloading Mona Sans, JetBrains Mono and the Noto Sans SC slices its Chinese text touches.
- **Fonts** in Settings → Appearance still replaces the Latin face and the CJK face; under Primer, "Theme default" came to mean Mona Sans and Noto Sans SC.
- The Credits page listed Primer among the themes that use Mona Sans, JetBrains Mono and Noto Sans SC.
- The gallery's Fonts (字体) page showed the new faces: in Primer's row of the default-faces table and in Primer's specimens.
