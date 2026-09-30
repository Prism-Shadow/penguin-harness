# Web App: the first paint waits on one small `/api/me`, asked alongside `/api/install`

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [Myriad-Dreamin/penguin-harness#117](https://github.com/Myriad-Dreamin/penguin-harness/pull/117)
- **Breaking:** yes — `UserInfo` no longer carries the avatar as `avatar`; it carries `avatarRev`, and the image is served by `GET /api/me/avatar`

[中文版](2026-09-30-first-paint-one-me.zh.md)

Before its first paint a page waited on two requests in a row: the mount waited for `GET /api/install` (up to 3 s), and the route guard then waited for `GET /api/me`. `/api/me` was also asked twice — once by the sign-in state, once by the API socket finding out who it was for — and every answer carried the account's avatar inline, about 28 KB with a typical picture. Now `/api/me` is asked once, at the same moment as `/api/install`, and it is a few hundred bytes.

## Details

- The boot asks `GET /api/me` while it waits for the install id, and the sign-in state takes that answer when the app mounts instead of asking again.
- While a `GET /api/me` is in flight, the API socket waits for its answer rather than asking the same question itself. If that request fails, the next call asks as before.
- `UserInfo` (in `GET /api/me`, the sign-in answers and `PUT /api/me/profile`) carries `avatarRev`, the content revision of the avatar, instead of the image. The image is served by `GET /api/me/avatar?rev=<avatarRev>`, cached for good because a new picture is a new revision — the shape the employee avatar already has. Each account gets only its own avatar.

## Compatibility

- Nothing on disk changes: the avatar is still stored in the same column and is served from it.
- An API client that read `user.avatar` from these answers now finds `user.avatarRev` instead and fetches the image from `GET /api/me/avatar`. The Web App served by the same server is updated with it.
