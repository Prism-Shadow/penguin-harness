---
title: Agent 定义包
---

- feat(server): agent 包——Agent 的定义按插件包分发，通过复制装进项目

  Agent 包是一个插件包，其定义部分就是一个 Agent 的定义：`agent_state/` 里的技能、钩子与配置，加上 `system_config.yaml` 与 `AGENTS.md`。没有 `package.json` 的包也可以是 Agent 包——名字取包目录或可选的 `agent.json`；带 `package.json` 时，npm 关键词 `penguin-agent` 标记它、npm 语义照常适用。下载走插件的渠道（npm 包名、git 或 tarball 链接、上传的 zip）；下载之后是把定义复制进项目的 `agents/` 目录——不跑安装脚本、不写凭据、不执行任何东西。Agent 活出来的历史（`traces/`、`snapshots/`、`workspaces/`、`memory/`、保险库）从不进包。
