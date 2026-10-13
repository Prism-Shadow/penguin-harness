# RSI toolkits: display names

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `plugins`, `web`
- **PR:** [#1081](https://github.com/Prism-Shadow/penguin-harness/pull/1081)

[中文版](2026-10-12-rsi-toolkit-titles.zh.md)

The five RSI toolkits had no display name, so the Plugins page cards and the **Method** list of the Use dialog's Optimize tab showed package names such as `opro-rsi-toolkit`. Each toolkit's `package.json` now carries `title` and `title_zh`.

## Details

- Titles: Default RSI Toolkit (默认 RSI 工具包), OPRO RSI Toolkit, APE RSI Toolkit, ACE RSI Toolkit and AWM RSI Toolkit (each "… RSI 工具包" in Chinese).
- The short descriptions used to begin with that same name as a stand-in; the prefix was removed so the card and the Method hint do not repeat the title. The full descriptions are unchanged.
- The Chinese notice for an optimizer agent without the `agent-optimization` Skill, and the Chinese Self-improvement docs page, name the default toolkit by its Chinese title.
