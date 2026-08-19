# 离线重置管理员密码：`penguin server reset-admin-password`

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `cli`, `server`
- **PR:** [#315](https://github.com/Prism-Shadow/penguin-harness/pull/315)

[English](2026-08-18-admin-password-reset.md)

管理员可以从用户管理页重置其他每一个用户的密码，但**管理员自己**的密码一旦从初始密码改掉之后再忘记，就没有任何找回途径（数据根目录中的明文文件只在密码仍为初始值期间存在）。一个新的 CLI 子命令从拥有该数据根目录的那台机器上补齐了这个缺口：

```bash
penguin server reset-admin-password
```

- 当有存活的服务端占用该根目录时拒绝执行（`web.db` 是单写者），并指出正在运行的实例；在服务端已停止的情况下，它把内置的 `admin` 重置为一个全新的随机 `penguin-<4 位数字>` 初始密码，并以服务端启动时所用的同一个带框提示打印出来。
- 整套初始密码机制被重新武装：置上 `password_is_initial`，明文以仅所有者可读的权限存入数据根目录，带框提醒在每次服务端启动时重新打印直到密码被修改——同时 admin 的所有登录会话被清除，与管理员发起的重置行为一致。
- 无可重置内容的根目录会被如实报告且不产生副作用：缺失的 `web.db` 绝不会被该命令创建，而未初始化的数据库会被明确指出。
- 实现：一个无副作用的 `@prismshadow/penguin-server/reset-admin-password` 子路径导出（与 `./lock` 同理），使 CLI 无需导入会开始监听的服务端入口即可执行重置。授权依据是本地文件系统访问权——能运行它的人，本就拥有它所写文件旁边的那个 SQLite 数据库。
- 可发现性：`penguin server` 会直接启动服务，因此没人会去翻它的子命令帮助——登录页页脚新增第二行提示点名该命令（那是被锁在门外的管理员必定会看的地方），而 `server` 命令的描述里也提到该子命令，使它出现在顶层 `penguin --help` 中。
