# Backward compatibility

- **Date:** 2026-10-26
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1339](https://github.com/Prism-Shadow/penguin-harness/pull/1339)

[中文版](2026-10-26-backward-compatibility.zh.md)

[Settings and drafts follow the account](2026-10-26-settings-follow-account.md) moved preferences and drafts that every browser already holds to the server, and added two tables to `web.db`. Only the browser side needed a decision; the tables are recorded here too, so "does my install need anything?" has one answer in one place.

## Preferences and drafts already in a browser

Before this change the Settings preferences and the drafts lived only in the browser's `localStorage`: `penguin.theme`, `penguin.themeId`, `penguin.accent`, `penguin.textSize`, `penguin.fontLatin`, `penguin.fontCjk`, `penguin.lang`, `penguin.currency`, `penguin.terminal.theme`, `penguin.toolAliases`, `penguin.notifications`, `penguin.dock.launcherHidden`, `penguin.steerMode`, `penguin.background.image` and `penguin.background.settings`, and the draft families `penguin.chatDraft.*`, `penguin.chatDrafts.*`, `penguin.channelDraft.*`, `penguin.orgCreateDraft.*` and `penguin.a2uiDraft.*`. Now the account on the server is the truth. Left alone, the first sign-in after the upgrade would have replaced them with the account's empty copy: every theme and language back to its default, and every unsent draft gone.

Chosen (owner's decision): **a one-time import.** On a browser's first sign-in after the upgrade:

- its cached preferences, the background image included, go up to the account, provided the account holds none of them yet and this browser has not handed its preferences to any account before. The browser records that in `penguin.prefsImported`, so a second account signing in on the same browser never receives the first one's;
- the signed-in user's drafts that the account does not have go up, recorded per user in `penguin.draftsImported.<user>`. A2UI form answers in progress are not imported: their keys carry no user, so on a browser two accounts share the account signing in first would be handed the other's answers. This browser drops them at that sign-in; answers given from then on follow the account like any draft.

From then on the server's copy wins. The keys stay where they were, as the browser's cache, so nothing in the browser is renamed or rewritten. Both markers are scoped to the data root: a browser pointed at a wiped data root imports again, into the new root's account.

Scope: every browser, and every desktop app window, of every account. A browser shared by several accounts gives its preferences to whichever signs in first.

Users do nothing. Someone with several browsers whose looks differ gets the look of the browser they sign in from first after the upgrade; the others then follow the account. Changing a setting anywhere afterwards changes it everywhere.

**Removal:** the import stays until 0.3.0 and is removed in that release's preparation: the two markers, the `importing` branches in `packages/web/src/lib/account-sync/prefs.ts` and `drafts.ts`, the paragraph in `sync.ts`, and their test cases. The two marker keys then go from the install-scope table too; an old marker left in a browser is never read again and is swept with the next data-root change.

## The new tables

`user_drafts` and `user_background_images` are added by `2026-10-26-user-drafts`, an expand migration: both rows go with their user, and an existing `web.db` gains two empty tables. It needs no decision and stays as long as migrations are kept.

A downgrade is invisible: an older build never reads the tables, and its Web App goes back to keeping preferences and drafts in the browser, where the cache still holds this browser's latest values. Edits made in another browser after the upgrade are not in this one. The migration's `down` drops both tables, and with them every draft and background image held on the server; a browser that still caches them keeps its copy.

## Compatibility

No action is required on upgrade or on downgrade.
