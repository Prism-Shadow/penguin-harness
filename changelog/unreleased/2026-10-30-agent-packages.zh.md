---
title: Agent 定义作为插件包贡献
---

- feat(server)：Agent 的定义作为包在 ifaces.json 里携带的模块贡献，在包装载时复制进项目

  插件包贡献一个 Agent 定义，方式同贡献一个沙箱 provider：入口文件里的一个模块，其生成的
  清单表——package.json 旁边的 `ifaces.json`——把贡献带进 agents 机制的 `definitions` 槽位。
  贡献的静态半边命名 Agent——定义安装所用的 id；它的 CODE 半边是贡献者把自己的 `agent_state/`
  流式复制进目标——几十 G 的定义也只是磁盘 IO，内存里不留任何一份。没有任何代码靠读包来
  找文件——manifest 是数据，复制是贡献者自己携带的代码，像沙箱后端一样绑在自己的贡献上。
  列出这个包就应用了项目的插件表，随之而来的装配把定义复制进每一个列出该包的项目：复制时
  不执行任何东西、不写凭据、不为定义加载任何模块。重装就地更新副本，手工删掉的目录由下一
  次装配回填。Agent 活出来的历史（`memory/`、`traces/`、`snapshots/`、`workspaces/`、
  `scratchpad/`、保险库）是运行时状态，从不进包；没有表、只有裸 `agent_state/` 的包不是
  插件。
