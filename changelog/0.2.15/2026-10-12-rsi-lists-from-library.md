# Method select and start page counts read the plugin library and the Evaluation Center

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1066](https://github.com/Prism-Shadow/penguin-harness/pull/1066)

[中文版](2026-10-12-rsi-lists-from-library.zh.md)

The Web App stopped listing the RSI toolkits itself. The Optimize tab's **Method** select is built from the plugin library each time the Use dialog opens, and the start page reads its toolkit and Benchmark counts again every time it is shown, so a toolkit an admin installs or removes, or a Benchmark imported or deleted, shows without reloading the page.

## Details

- **Method** offers one option per plugin of the library's `rsi` category (Agent Self-Evolution), with `default-rsi-toolkit` first. An option's label is the plugin's display name, else its package name, and its hint is the plugin's short description, else its full one, in the interface language. The per-toolkit labels in the two dictionaries were removed.
- `default-rsi-toolkit` keeps the default loop's form (round limit, target score) and preselects `agent-optimization` with `agent-evaluation`. Any other toolkit runs the Skill named like its plugin, else the first Skill its quick start preselects that it ships, else its only Skill. A toolkit none of these settles is left out of the select.
- While the library is being read, when the read fails, or when it holds no toolkit, the select is disabled with a line saying which, and the tab optimizes with the default loop. The Evaluate tab does not depend on the library.
- The prompt for a toolkit other than the default names only its Skill ("run its method"), not a display label.
- The start page's 自进化算法 / RSI algorithms count is read again on every visit, as the Benchmarks count already was. Until the fresh read lands it shows the number from the previous visit, and a failed read leaves that number in place.
- The Evaluation Center docs describe the Method list as read from the library.
