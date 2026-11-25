# 把 chat、session list 与 dock 的 web 半面搬进 session 库

- **Date:** 2026-11-25
- **Type:** refactor
- **Scope:** `web`

[English](2026-11-25-session-web-half.md)

chat、session list 与 dock 三个 feature 的 web 半面现迁入 `library/session/src/web`，Web App 经 session 库的 `./web` 导出消费它们。搬动后的代码经单一子路径（`@prismshadow/penguin-web/internal`）消费 Web App 的内部面，不再从 App 的文件树直接导入。行为无变化。
