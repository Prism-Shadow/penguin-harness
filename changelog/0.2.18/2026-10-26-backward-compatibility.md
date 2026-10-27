# Backward compatibility in this batch

- **Date:** 2026-10-26
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336), [#1339](https://github.com/Prism-Shadow/penguin-harness/pull/1339), [#1351](https://github.com/Prism-Shadow/penguin-harness/pull/1351)

[中文版](2026-10-26-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.
## An `Origin` a Penguin Remote hop rewrote to `http://`

A desktop released before [the public origin](2026-10-26-oauth-callback-port.md) trusts no proxy and compares a write's `Origin` with the request's own origin: the connection's scheme, plain HTTP, with its `Host`. So that those desktops take writes through Penguin Remote, a hop of the relay, today the Penguin Remote client on the user's machine, rewrites a browser `Origin` of `https://u<N>.go.penguin.ooo` to `http://u<N>.go.penguin.ooo` when it names the tunnel's own host. A desktop with the public origin expects `https://`, so it accepts the request's own origin as well, and keeps working behind that rewrite.

### Scope

The origin check on writes (`/api/*` and `/server/*`), on the API socket and terminal WebSocket handshakes, and on a workbench's handler, on the desktop app's embedded server only: the one server Penguin Remote reaches, recognised by desktop mode (`PENGUIN_DESKTOP_TOKEN`). There the request's own origin passes whatever the forwarded headers say. Every other server, behind a trusted proxy or not, accepts the public origin alone ([trust-proxy hardening](2026-10-26-trust-proxy-hardening.md)); without a trusted proxy the two origins are the same anyway.

### What you need to do

Nothing on a desktop. The Penguin Remote client keeps the rewrite while desktops from before this change connect through the relay.

### Lifetime

Before 0.3.0, the Penguin Remote client stops rewriting `Origin` and instead sets `X-Forwarded-Proto: https` and `X-Forwarded-Host: <public host>`, overwriting any value already there, and keeps the public host as `Host`. In 0.3.0 the server maintainers delete the acceptance of the request's own origin (`OriginRule.acceptOwnOrigin` and its first use in `acceptsOrigin`, `packages/server/src/http/public-origin.ts`, with the `acceptOwnOrigin` option of `packages/server/src/terminal/ws.ts`), and the desktop accepts the public origin alone too.

## Preferences and drafts already in a browser

[Settings and drafts follow the account](2026-10-26-settings-follow-account.md) moved preferences and drafts that every browser already holds to the server, and added two tables to `web.db`. Only the browser side needed a decision; the tables are recorded here too, so "does my install need anything?" has one answer in one place.

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
