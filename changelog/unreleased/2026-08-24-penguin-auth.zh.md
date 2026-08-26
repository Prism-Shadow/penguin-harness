# `penguin auth` —— 终端登录、首次登录链接、离线管理员重置

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#443](https://github.com/Prism-Shadow/penguin-harness/pull/443)
- **Breaking:** yes —— 固定种子密码退役，改为通过打印的首次登录链接认领账号

[English](2026-08-24-penguin-auth.md)

现在可以从终端登录服务器，围绕它的账号引导也重建了：新服务器打印首次登录链接而非固定密码，管理员忘记密码可离线恢复。会话仍是 `web.db` 里的服务端行，因此重启后依然有效。

```bash
penguin auth login                      # 用密码登录本数据根上的服务器
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # 无需密码：在本机写入一行会话
```

## 两种登录方式

`login` 向运行中的服务器请求会话，默认指向本数据根上的服务器，登录自己的无需 URL。交互式时先问账号并在密码提示里点名；通过 `PENGUIN_PASSWORD` 或 `--password` 提供密码则什么都不问，优先用环境变量——命令行经 `ps` 全局可读。默认目标取自**存活**的 server lock（PID + 端口），因此密码不会发到某个崩溃残留 lock 的、已被别的进程占用的端口。

`token` 不需要密码。会话是 `web.db` 里的一行，因此它打开数据库插入一行——能读数据根本就已触及该令牌能触及的一切凭证，写入不增加权限。它不需要服务器在跑，服务器在跑时也安全（WAL + 忙等超时），适用于管理员密码是人工设定的机器、或不能携带密码的脚本。默认裸输出以便 `TOKEN=$(penguin auth token)`；`--mark` 在前面加一行标记，供从可能打印横幅的 shell 里解析的调用方。

CLI 会话记在 `<root>/cli-session.json`（0600，防 symlink 写）；`logout` 在服务端删除它，而不仅是本地。

## 首次登录与管理员恢复

新服务器的种子密码是 24 位 base64url（144 比特），生成后即哈希、丢弃、无人见过——从账号存在那一刻起就在登录端点上不可猜。在密码被设置之前，每次启动打印一条登录链接。链接携带一个 `setup` 会话——可免旧密码设置密码，且不开启任何桌面专属路由——在 `GET /api/auth/claim` 兑换（桌面客户端的一次性令牌也走这条路由）。它刻意可重复使用直到认领：邮件客户端或浏览器的预取不能在读者点开前就把它烧掉，而它在密码存在的那一刻即失效。已认领的服务器根本不签发这样的会话。

`penguin server reset-admin-password` 在离线（服务停止）时把管理员退回未认领状态，删除其会话、不产生任何明文；下次启动打印新链接。

## 会话

会话是 Cookie 里的一个 32 字节随机令牌，以其 sha256 存于 `auth_sessions`；行即会话，所以 logout 删除它、管理员重置删除该用户的行。有效期 **30 天**（此前 7 天），滑动续期在原地续（Cookie 值不变），且只有自身跨度达到续期窗口的会话才滑动，因此 1 小时的 `cli` 令牌就在 1 小时到期。会话跨服务器重启存活，因为它在磁盘上。

## 兼容性

固定种子密码（未设置 `PENGUIN_SEED_ADMIN_PASSWORD` 时旧版打印 `penguin-<四位数字>`）退役：改为通过服务器打印的首次登录链接认领账号。从旧版沿用的数据根，其 `initial-admin-password` 明文会在下次启动时删除（一直清扫到没有受支持的升级路径能携带它——记录在 `initial-password.ts`）。

v0.2.0 的 `web.db` 里的会话会保留：`auth_sessions` 表在下次启动时补上 `via` 列，已有行按普通密码会话处理，因此从正式版升级不会让任何人掉线。（中间那个未发布版本——临时的签名令牌方案——签发的会话根本不是行，会直接失效。）

会话 Cookie 的 `Secure` 标记现在需要部署方显式开启：此前 `x-forwarded-proto` 被无条件信任，任何能连到明文 HTTP 端口的人都能骗出一个浏览器随后拒绝回传的 `Secure` Cookie。经反向代理提供 HTTPS 的部署需设置 `PENGUIN_TRUST_PROXY=1`（并继续转发 `x-forwarded-proto`）以保持会话 Cookie 带 `Secure`；不设置则签发的 Cookie 不带该标记。

`penguin server auth-token` 现为 `penguin auth token`；`GET /api/auth/desktop-login` 现为 `GET /api/auth/claim`。
