# Settings and drafts follow the account

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`, `web`, `ui-gallery`, `docs`
- **PR:** [#1339](https://github.com/Prism-Shadow/penguin-harness/pull/1339)

[中文版](2026-10-26-settings-follow-account.zh.md)

The preferences set on the Settings pages and the Web App's unsent drafts moved from the browser to the account on the server, so another browser, or the desktop app, signed in to the same account shows the same theme, language and drafts. Each browser keeps them as a cache for its first frame, and the server's copy wins. A browser upgrading into this release hands its own values over once; see [backward compatibility](2026-10-26-backward-compatibility.md).

## What follows the account

- Preferences: theme, light or dark, accent, text size, fonts, the background image and its display settings, terminal theme, tool short names, the shortcuts launcher switch, interface language, currency, task-completion notifications, and the composer's mid-run send mode. Work mode, the personal company-mode switch and keyboard shortcuts were already on the account.
- Drafts: the new-conversation draft and each Session's composer, with their Workspace, Agent, model and approval picks; parked draft conversations; company-mode channel composers; the create-organization form; and A2UI form answers in progress.
- Kept in the browser: panel and file-tree widths, the dock layout, sidebar and group folds, pins and manual order, where the launcher rests, the Plugins page's "incompatible plugins only" filter, the Project and Agent last opened, and notices dismissed in that browser.

## Details

- `ui_prefs` gained the preference keys above, checked for shape by `PUT /api/me/prefs`. The background image is stored apart, in a `user_background_images` table, through the new `GET|PUT /api/me/background-image` (a data URL of at most 1 MiB); `ui_prefs.backgroundImageId` names it, and only that route writes it.
- New `GET|PATCH /api/me/drafts` over a `user_drafts` table keyed `<kind>:<id>`. A draft is capped at 256 KiB and an account at 200 drafts and 4 MiB, the least recently written going first. Deleting a Session, an Agent or a Project deletes every user's drafts of it. Migration `2026-10-26-user-drafts` adds both tables.
- The Web App reads the account's preferences and drafts before the signed-in app renders, waiting a bounded time. An edit is written to the browser's cache at once and sent to the server shortly after, batched; the last write wins across browsers. An edit the server has not acknowledged is journaled in the browser and wins at the next sign-in. Signing out sends what is pending first, and a language or theme picked on the sign-in page is saved to the account that signs in.
- In a browser that has never been granted notification permission, the notifications switch shows off while the account has them on, with a line saying so; turning it on there asks for permission.
- Drafts of a Session on a connected machine are kept on the server the person signed in to, and the Web App deletes them with the Session.
