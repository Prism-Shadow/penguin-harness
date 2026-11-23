# 终端中自动折行的网址可以完整打开

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1698](https://github.com/Prism-Shadow/penguin-harness/pull/1698)

[English](2026-11-22-terminal-wrapped-links.md)

终端里的 HTTP 或 HTTPS 网址自动折行后，点击任意一段都能打开完整地址，包括查询参数和片段。重新连接终端后仍保留自动折行，分别输出在两行的网址保持独立。
