# 向后兼容

- **Date:** 2026-09-15
- **Type:** process
- **Scope:** `server`
- **PR:** [#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

[English](2026-09-15-backward-compatibility.md)

这条线上只有一件事会活过一次发布：它新增的数据库迁移的编号。

这条线早先的构建把 machines 的列编为 5、Session surface 的列编为 6。已发布的构建把 5 用在了 `users` 的昵称与头像两列上，于是这两项迁移改为 6 与 7，而被这条线早先构建打开过的数据根，其记录的版本号会让「昵称与头像」这项迁移看起来已经执行过。它又恰好是唯一一项其列不会在进程启动时由 `openDatabase` 再声明一遍的迁移：这样的数据根上 `users` 将一直缺这两列，任何账号读取都会失败。

编号为 8 的迁移 `user-profile-adoption` 会在缺失时补上这两列。用户无需手动处理：它在下一次启动或下一次推送时执行；本来就按正常顺序执行过该迁移的数据根，会发现列已存在而不做任何事。

## 兼容性

当不再可能有数据根运行那些早先的构建时，这个条目即可移除——machines 这条线自身发布就是那个时刻，移除时只需从 `MIGRATIONS` 中删掉一项。
