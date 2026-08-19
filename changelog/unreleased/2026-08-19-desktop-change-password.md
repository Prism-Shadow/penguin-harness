# Web App: the desktop window stops offering "Change password"

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#349](https://github.com/Prism-Shadow/penguin-harness/pull/349)
- **Issue:** [#346](https://github.com/Prism-Shadow/penguin-harness/issues/346)

[中文版](2026-08-19-desktop-change-password.zh.md)

The sidebar user menu offered **Change password** to every session, including the desktop app's own window — the one session that has never seen a password. The desktop shell signs in by redeeming a one-shot token instead of a login form, and the seed password of a desktop-created data root is fully random and deliberately never printed, so the entry asked its holder to replace a secret they could not name. It is now hidden there, joining the update row, the Users entry and sign-out, which desktop mode already dropped.

## What the entry is keyed on

Visibility is decided by a small pure predicate (`offersChangePassword`), on the pair of fields `GET /api/me` already reports — `desktopMode` (the server was spawned by the desktop shell) and `sessionVia` (this session came from the shell's token rather than the login form). Both must hold, which mirrors the server's own gate on `PUT /api/me/password`, and matters in two directions:

- Keying on `desktopMode` alone — the shape the sibling entries in that menu use — would also strip the control from a browser pointed at the same desktop-mode server over loopback. That session typed a real password at the login form and the server still lets it change one, so it would have been stranded.
- Keying on `sessionVia` alone would strip it from a desktop cookie replayed against a plain `penguin server` on the same shared data root, where the old password is required like anywhere else.

No new mechanism was introduced: `desktopMode` was already the web app's single source for desktop-mode branching, and the change-password dialog was already keyed on `sessionVia`.

## The route is untouched

Nothing was removed or gated server-side. `PUT /api/me/password` stays reachable and fully functional in desktop mode, including its no-old-password path for desktop sessions — the hidden entry is a working control, not a broken one, so a future caller or an automation is unaffected. A desktop-created root that later needs a password a human can actually use gets one offline from `penguin server reset-admin-password`, which the desktop quickstart now points at.

## Regression cover

A unit test pins the rule by value across all four `desktopMode` × `sessionVia` states — absent only in the desktop shell's window, present in the browser and multi-user cases — and asserts the menu consumes the predicate rather than rendering the entry unconditionally, since the frontend suite runs node-only and cannot render the menu itself.
