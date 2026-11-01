---
title: Agent 定义作为插件包贡献
---

- feat(server)：Agent 的定义作为一个模块贡献，从包的 ifaces.json 读取，通过复制装进项目

  插件包贡献一个 Agent 定义，方式同贡献一个沙箱 provider：入口文件里的一个模块，其生成的
  清单表——package.json 旁边的 `ifaces.json`——把贡献带进 agents 机制的 `definitions` 槽位。
  贡献的静态半边只是数据：一个展示名，加上定义文件的包内相对路径，即包的 `agent_state/`
  内容。服务端读这张表而不导入任何东西——manifest 是数据，不经执行即读取校验——没有这个
  贡献、只有裸 `agent_state/` 的包不是 Agent 包。包仍是普通的插件包，走插件的渠道下载
  （npm 包名、git 或 tarball 链接、上传的 zip）；下载之后是把列出的文件复制进项目的
  `agents/`，以包名的 unscoped 部分命名——复制时不执行任何东西、不写凭据、不加载任何模块。
  重装就地更新这份副本。Agent 活出来的历史（`memory/`、`traces/`、`snapshots/`、
  `workspaces/`、`scratchpad/`、保险库）是运行时状态，从不进包。
