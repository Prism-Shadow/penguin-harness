---
title: Agent 定义作为插件包贡献
---

- feat(server)：Agent 的定义作为插件包的一种贡献面分发，通过复制装进项目

  插件包可以像携带 skills、hooks 或 MCP servers 那样携带一个 Agent 定义：package.json 旁边的
  一个 `agent_state/` 目录——没有标记，没有额外清单。包仍是普通的插件包，走插件的渠道下载
  （npm 包名、git 或 tarball 链接、上传的 zip）；下载之后是把那个目录复制进项目的 `agents/`，
  以包名的 unscoped 部分命名——复制时不执行任何东西、不写凭据、不加载任何模块。重装就地更新
  这份副本。Agent 活出来的历史（`memory/`、`traces/`、`snapshots/`、`workspaces/`、
  `scratchpad/`、保险库）是运行时状态，从不进包。
