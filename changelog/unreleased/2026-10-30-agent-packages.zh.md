---
title: Agent 定义作为插件包贡献
---

- feat(server)：Agent 的定义作为插件包的一种贡献面，由包在自己的 manifest 里注册，通过复制装进项目

  插件包注册一个 Agent 定义，方式同注册 hook 包或 MCP servers：自己的 manifest 里的一行——
  package.json 中的 `"penguin": { "agent": true }`。定义的内容放在包的 `agent_state/` 目录，
  如同技能放在 `skills/<name>/`。服务端读的是这一条声明，而不是扫包里的部件：没有声明、
  只有裸 `agent_state/` 的包不是 Agent 包；除 `true` 以外的形式以警告忽略。包仍是普通的
  插件包，走插件的渠道下载（npm 包名、git 或 tarball 链接、上传的 zip）；下载之后是把那个
  目录复制进项目的 `agents/`，以包名的 unscoped 部分命名——复制时不执行任何东西、不写凭据、
  不加载任何模块。重装就地更新这份副本。Agent 活出来的历史（`memory/`、`traces/`、
  `snapshots/`、`workspaces/`、`scratchpad/`、保险库）是运行时状态，从不进包。
