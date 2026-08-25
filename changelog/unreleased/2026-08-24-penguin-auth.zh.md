# `penguin auth`、签名会话，以及磁盘上不再留鉴权秘密

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#443](https://github.com/Prism-Shadow/penguin-harness/pull/443)
- **Breaking:** yes — upgrading signs everyone out once, and `penguin auth token` needs a running server

[English](2026-08-24-penguin-auth.md)

现在可以在终端里登录服务了，其下的会话机制也随之改变以适配它：会话变成签名令牌，签名密钥迁入进程内存，
数据根里最后两个长期秘密就此消失。

```bash
penguin auth login                      # 用密码登录该数据根上运行的服务
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # 不需要密码：改为证明本机所有权
```

## 两种登录方式

`login` 向正在运行的服务请求会话，默认目标是该数据根上的那个，所以登录自己的服务不必写 URL。交互运行时
先问账号，并在密码提示里写明是哪个账号；用 `PENGUIN_PASSWORD` 或 `--password` 给了密码就什么都不问。
优先用环境变量——命令行参数可以被 `ps` 看到。

`token` 不需要密码。它的授权依据是你能读数据根，因此适用于管理员密码被人改过的机器，或不该持有密码的
脚本。它裸打印令牌，便于 `TOKEN=$(penguin auth token)`；`--mark` 会在令牌前加一行标记，供需要从可能打印
横幅的 shell 输出里解析它的调用方使用。

会话记在 `<root>/cli-session.json`，权限 0600。`logout` 会在服务端吊销它，而不只是本地忘记。

## 会话

会话现在是 `v1.<claims>.<hmac>`——账号、来历、过期时间、唯一 id——验证成本是签名运算加一次用户查询，
而不是每请求一次数据库读取。`auth_sessions` 表随之删除：数据库现在只记录例外——登出写入吊销表，管理员
重置密码盖上按用户的标记，作废该用户更早的令牌。

浏览器会话为 **30 天**（原先 7 天），临近过期时以替换 cookie 续期，因此常规使用中的会话永不过期；一小时
的铸造令牌从不续期。来历本身不授予任何权限——凡不是 `desktop` 的都按普通密码会话处理。

## 磁盘上不再留鉴权秘密

签名密钥在进程启动时生成、从不落盘，因此重启即轮换所有在外会话。热更新不换进程，CLI 与机器令牌按需重铸；
真重启后的浏览器会话代价是重输一次密码。

本机所有权由 `<root>/owner-token` 锚定：每次启动写入的新随机值，0600，在 `POST /api/auth/owner` 兑换。
服务停止时，`penguin auth token` 改为直接写入一条会话记录。

新服务器的种子密码生成后即哈希、丢弃，无人见过；在密码被设置之前，每次启动打印一条一次性登录链接。链接
里装的是一个普通的 `setup` 会话——可以免旧密码设置密码，且不开启任何桌面专属路由——在
`GET /api/auth/claim` 兑换，桌面客户端的一次性令牌也走这条路由。
`penguin server reset-admin-password` 把管理员账号退回该未认领状态，不产生任何明文。

## Compatibility

从更早版本沿用的数据根，其 `initial-admin-password` 文件会在下次服务启动时被删除。账号密码本身没变，
仍在使用初始密码的服务会改为打印登录链接。等到所有受支持的升级路径都不可能再带着那个文件时移除这段
清扫——跟踪点在 `initial-password.ts`。

旧版本的会话不再沿用：`auth_sessions` 表被删除，升级后所有人需重新登录一次。在这个模型里重启本就会结束
全部会话，而升级就是一次重启。

`penguin auth token` 现在需要有服务在运行来为它签名，没有时会如实报错。`penguin server auth-token` 现为
`penguin auth token`；`GET /api/auth/desktop-login` 现为 `GET /api/auth/claim`。
