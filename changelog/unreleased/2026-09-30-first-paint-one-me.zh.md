# Web App：首绘只等一条轻量的 `/api/me`，且与 `/api/install` 同时发出

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [Myriad-Dreamin/penguin-harness#117](https://github.com/Myriad-Dreamin/penguin-harness/pull/117)
- **Breaking:** yes — `UserInfo` 不再以 `avatar` 携带头像，改为携带 `avatarRev`，图片由 `GET /api/me/avatar` 提供

[English](2026-09-30-first-paint-one-me.md)

页面首绘之前要先后等两条请求：挂载等 `GET /api/install`（最长 3 s），之后登录守卫再等 `GET /api/me`。`/api/me` 还会被问两次——登录状态一次、API socket 确认自己属于谁一次——而且每次都内联着账户头像，常见图片下约 28 KB。现在 `/api/me` 只问一次、与 `/api/install` 同时发出，回包只有几百字节。

## Details

- 启动时在等待 install id 的同时发出 `GET /api/me`，应用挂载后登录状态直接取这条的答复，不再另问。
- 有 `GET /api/me` 在途时，API socket 等它的答复，不再自己再问一遍；这条请求失败时，下一次调用照旧自己去问。
- `UserInfo`（`GET /api/me`、登录的答复与 `PUT /api/me/profile`）改带头像的内容版本 `avatarRev`，不再带图片本身。图片由 `GET /api/me/avatar?rev=<avatarRev>` 提供，换图即换版本，因此可长期缓存——与员工头像现有的形状一致。每个账户只能取到自己的头像。

## 兼容性

- 磁盘上没有任何变化：头像仍存在原来的列里，路由直接从那里取。
- 从这些答复里读 `user.avatar` 的 API 调用方，现在读到的是 `user.avatarRev`，图片要从 `GET /api/me/avatar` 取。同一台服务端提供的 Web App 已随之更新。
