# 机器页：在页内新建 ssh 主机

- **Date:** 2026-09-05
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#624](https://github.com/Prism-Shadow/penguin-harness/pull/624)

[English](2026-09-05-machines-ssh-hosts.md)

还没写进服务端 ssh 配置的机器，现在可以直接在机器页里声明。「添加机器…」旁边的 **+** 打开一个简短的表单——别名、地址，以及可选的用户、端口和密钥文件——服务端会把对应的 `Host` 块追加到它自己的 `~/.ssh/config`。之后这台主机就和其他主机一样出现在「添加机器…」里。

## 细节

- 写入的是 ssh 自己的语法，开头一行注释标明由 PenguinHarness 于何时写入，方便日后翻看配置的人分辨哪些行不是自己写的。
- 每个值必须是一个词且不含 `#`，别名不能是通配模式，端口必须是 1 到 65535 之间的整数。表单会在发送前就在字段下方说明。
- 配置里已有的别名会被拒绝：ssh 只认先出现的那一块，新块会被静默忽略。
- 目录和文件不存在时，按 ssh 要求的权限创建。
- 服务端新增 `POST /api/projects/:projectId/machines/ssh-hosts`，返回机器列表（`201`）、指明字段的 `400 ssh_host_invalid`，或 `409 ssh_host_exists`。与该路由组其余部分一样仅管理员可用。
