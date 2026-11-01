---
title: Agent 定义作为插件包贡献
---

- feat(server)：Agent 的定义作为包在 ifaces.json 里携带的模块贡献，在包装载时复制进项目

  插件包贡献一个 Agent 定义，方式同贡献一个沙箱 provider：入口文件里的一个模块，其生成的
  清单表——package.json 旁边的 `ifaces.json`——把贡献带进 agents 机制的 `definitions` 槽位。
  贡献的静态半边只是数据：定义安装所用的 Agent id、一个展示名，加上定义文件的包内相对路径，
  即包的 `agent_state/` 内容。没有任何代码靠导入包来读它——manifest 是数据，不经执行即读取
  校验。列出这个包就应用了项目的插件表，随之而来的装载——安装应用、推送、启动都走同一条
  装载——把列出的文件复制进每一个列出该包的项目的 agents/：复制时不执行任何东西、不写凭据、
  不为定义加载任何模块。重装就地更新副本，手工删掉的目录由下一次装载回填。Agent 活出来的
  历史（`memory/`、`traces/`、`snapshots/`、`workspaces/`、`scratchpad/`、保险库）是运行时
  状态，从不进包；没有表、只有裸 `agent_state/` 的包不是插件。
