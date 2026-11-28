# Move the chat, session list and dock web halves into the session library

- **Date:** 2026-11-25
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-11-25-session-web-half.zh.md)

The web halves of the chat, session list and dock features now live in `library/session/src/web`, and the Web App consumes them through the session library's `./web` export. The moved code consumes the Web App's internals through one subpath (`@prismshadow/penguin-web/internal`) instead of importing from the app's file tree. No behavior changes.
