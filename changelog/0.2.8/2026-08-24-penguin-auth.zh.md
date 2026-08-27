# `penguin auth` —— 终端登录、首次登录链接、离线管理员重置

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#443](https://github.com/Prism-Shadow/penguin-harness/pull/443)
- **Breaking:** yes —— 固定种子密码退役，改为通过打印的首次登录链接认领账号

[English](2026-08-24-penguin-auth.md)

现在可以从终端登录服务器，围绕它的账号引导也重建了：新服务器打印首次登录链接而非固定密码，管理员忘记密码可离线恢复。

```bash
penguin auth login                      # 用密码登录本数据根上的服务器
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # 无需密码：在本机写入一行会话
```

## 细节

- `login` 向运行中的服务器请求会话，默认指向本数据根上的服务器，目标取自**存活**的 server lock（PID +
  端口）。交互式时先问账号并在密码提示里点名；用 `PENGUIN_PASSWORD` 或 `--password` 提供密码则什么都不问，
  优先用环境变量——命令行经 `ps` 全局可读。
- `token` 不需要密码：它打开 `web.db` 插入一行会话，因此不需要服务器在跑，服务器在跑时也安全（WAL +
  忙等超时）。默认裸输出以便 `TOKEN=$(penguin auth token)`；`--mark` 在前面加一行标记，供从可能打印横幅的
  shell 里解析的调用方。
- CLI 会话记在 `<root>/cli-session.json`，0600、防 symlink 写；`logout` 在服务端结束它，而不仅是本地。

## 首次登录

新服务器的种子密码是 24 位 base64url（144 比特），生成后即哈希、丢弃、无人见过。在密码被设置之前，每次启动
打印一条登录链接。链接携带一个 `setup` 会话——可免旧密码设置密码，且不开启任何桌面专属路由——在
`GET /api/auth/claim` 兑换（桌面客户端的一次性令牌也走这条路由）。它在认领前可重复使用，密码存在的那一刻即
失效；已认领的服务器不再签发这样的会话。

`penguin server reset-admin-password` 在离线（服务停止）时把管理员退回未认领状态，删除其会话、不产生任何
明文；下次启动打印新链接。

## 会话

会话是 Cookie 里的一个 32 字节随机令牌，以其 sha256 存于 `auth_sessions`。logout 删除该行，管理员重置密码
删除该用户的行，会话跨重启存活。有效期 **30 天**（此前 7 天），滑动续期在原地续、Cookie 值不变；只有自身
跨度达到续期窗口的会话才滑动，因此 1 小时的 `cli` 令牌就在 1 小时到期。

## 兼容性

固定种子密码（未设置 `PENGUIN_SEED_ADMIN_PASSWORD` 时旧版打印 `penguin-<四位数字>`）退役：改为通过服务器
打印的首次登录链接认领账号。从旧版沿用的数据根，其 `initial-admin-password` 明文会在下次启动时删除。

v0.2.0 的 `web.db` 里的会话会保留：`auth_sessions` 表在下次启动时补上 `via` 列，已有行按普通密码会话处理，
因此升级不会让任何人掉线。

会话 Cookie 只在部署方显式开启时带 `Secure`。经反向代理提供 HTTPS 的部署需设置 `PENGUIN_TRUST_PROXY=1`
并继续转发 `x-forwarded-proto`；不设置则签发的 Cookie 不带该标记。

`penguin server auth-token` 现为 `penguin auth token`；`GET /api/auth/desktop-login` 现为
`GET /api/auth/claim`。
