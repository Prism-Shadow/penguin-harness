# A profile page sets the user's avatar and nickname

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-09-12-user-profile.zh.md)

An account was its user id everywhere it appeared: the sidebar's bottom user row, the collapsed
rail's trigger, the admin user list. A new **Profile** page, heading the personal group of the
System settings dialog, gives every account an avatar and a nickname, and the surfaces that used
to draw the id and its letter tile draw those instead.

## Details

- The page holds two rows and one Save button. **Change avatar** opens a picture picker; the
  picked image is centre-cropped to a square and re-encoded at 128×128 as PNG, or as JPEG at
  quality 0.85 when the PNG would pass 100 KB. An image still over 128 KiB is refused inline
  instead of being sent for the server to reject, and **Remove avatar** appears only once one is
  set. The **nickname** is 1–32 characters, counted as characters so a Chinese name may be 32 of
  them, and clearing the field clears the nickname.
- The page is visible in every session, the desktop shell's own token window included — unlike
  the Account page beside it, which needs a password to change. `PUT /api/me/profile` follows the
  same rule and takes any authenticated session.
- The route is a patch: an absent field keeps its stored value, `null` clears it, and a body
  naming neither field is a 400. It validates the nickname's length and rejects control
  characters in it, and requires the avatar to be a `data:image/(png|jpeg|webp);base64,…` URL of
  at most 131072 characters whose payload decodes — the same number, in the same unit, that the
  browser measures its re-encode against.
- `GET /api/me` carries `displayName` and `avatar`, omitted when unset. The admin user list
  carries the nickname only — it is unpaged, and an avatar per account would answer a table
  that shows the nickname alone with megabytes. The avatar and nickname render through one
  shared `UserAvatar` component, so the nav row, the collapsed rail, the new account-menu
  header and the page's own 64px preview cannot drift apart; the admin list shows the nickname
  in small grey text under the user id.
- Schema migration 5, `user-profile`: two nullable columns, `users.display_name` and
  `users.avatar`. Additive and swap-safe — a platform rolled back to a predecessor that does not
  know them never reads or writes them — and reversible, though its `down` drops the columns and
  takes every stored nickname and avatar with them. Nothing to do for an existing install: every
  account simply starts with no profile and keeps showing its user id until it sets one.
