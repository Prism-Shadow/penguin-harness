# The desktop app signs its own window in when another server holds the data root

- **Date:** 2026-09-20
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `docs`
- **PR:** [#811](https://github.com/Prism-Shadow/penguin-harness/pull/811)

[中文版](2026-09-20-desktop-attach-sign-in.zh.md)

A desktop app that found another server already holding its data root — a `penguin web` or `penguin server` instance, or an older copy of the app still running — attached to that instance and left the window on the App's sign-in page. The password that page asks for does not exist: the desktop seeds its admin with a random value that is hashed and discarded unseen, so the only way on was `penguin server reset-admin-password` from a terminal. The shell now signs the window in itself, by minting a session in the data root it owns and setting the cookie for it, and answers any later arrival at the sign-in page the same way.

## Details

- `attach-session.ts` plans the sign-in: it calls the server package's `mintApiToken` on the data root and returns either the cookie to set or a failure to show. The minter is a parameter, so the module stays pure and every outcome is covered by tests.
- The minted session lasts thirty days, the same span an ordinary browser sign-in gets. Shorter sessions never reach the server's renewal window, so they expire on schedule however much the window is used.
- Attach mode sets the cookie before the window opens, then loads the app root. The same attempt runs from the main window's navigation events, so an expired session and a failed claim land signed in again instead of on the sign-in page. One attempt per arrival, re-armed only by reaching a page the App serves to a signed-in window.
- Signing out stands. The shell watches the App's request to end the session and leaves the sign-in page it leads to alone, until something signs in again or the app is launched again — every other arrival there is still answered.
- `mintApiToken` took a `via` option for the session's kind, defaulting to `cli` so `penguin auth token` is unchanged; the desktop mints `desktop`, which is what the App reads back to leave the current-password field out of its change-password form.
- The change-password form now decides whether to ask for the current password by the same pair the server's gate reads — a `desktop` session on a server started in desktop mode — so the field stops disappearing where the server still requires it.
- When minting fails — a `web.db` owned by another OS account, one written by another release, or a data root with no `web.db` at all — a dialog names the data root, the port and pid of the server holding it, the reason the minter gave, and the `penguin server reset-admin-password` rescue, then continues to the sign-in page.
- A child window sent to the sign-in page by a dying session closes instead of showing it, which returns a detached terminal's tab to the dock in the main window rather than stranding it behind a form it cannot use.
- The session cookie's name is a copy of the server's `SESSION_COOKIE`, pinned to that declaration by a test.
- The desktop quickstart gained a paragraph on what happens when another server owns the data root, and on what to do if a window still shows the login page.
- The initial-password trail keeps quiet in any window the shell signed in: it asks its reader to
  change a password they hold, and a shell-minted session holds none and cannot set one on a server it
  only attached to. The terminal that started that server saw the same notice at startup.
