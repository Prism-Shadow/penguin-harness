# Docker 导出可将容器固定到单个 Agent

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `docs`
- **PR:** [#610](https://github.com/Prism-Shadow/penguin-harness/pull/610)

[English](2026-09-04-pinned-agent-docker-export.md)

`penguin agent export <id> --kind docker --pin`——对应导出弹窗 Docker 分段的一个勾选项、以及包路由上的
`?kind=docker&pin=1`——打包出的容器，其服务端只提供这一个 Agent，并拒绝一切新建、导入、删除或改写
Agent 的请求，对所有人生效，内置管理员亦然。`--pin` 用于其他 kind 时报错。

## 详情

- **服务端模式。** `PENGUIN_PINNED_AGENT=<projectId>/<agentId>` 使服务端只提供该 Agent：它是唯一被列出的
  Agent，且只在唯一会列出 Agent 的那个 Project 中；在其他 Agent 上创建会话返回 `404`。以下返回
  `403 agent_pinned`：新建 / 导入 / 删除 Agent；`PUT /config`、`config/kernel-update`、`config/reset`；四条
  `template-placeholder`；技能包安装与卸载；插件安装与钩子卸载；Agent State 快照导入；定时任务的新建 /
  修改 / 删除；Project 的新建与删除。`workspace` 落在该 Agent `agent_state/` 内的会话同样被拒。
  `PUT /vault`、记忆、Project 改名、成员管理与一切读取不受影响。
- **新建用户成为该 Project 的 member**，不再获得 `<用户名>-default_project`——后者会带来第二个 Agent。
- **`GET /api/me` 携带 `pinnedAgent`**，Web App 据此撤下服务端会拒绝的入口：Agents 页的导入与创建、卡片的
  删除、侧栏的新建 Project 入口，以及 Agent 设置页上的全部写入控件，并在 Agent 名称下方以一行说明原因。
  被固定的卡片带一枚徽标。
- **首次启动分阶段进行。** 导入 Agent 是经由运行中的服务端完成的写入，而这正是固定模式所拒绝的，因此
  entrypoint 先对一个绑定 `127.0.0.1`、容器外不可达的短命服务端完成导入，随后（可选）对一个已固定的
  服务端播种 `PENGUIN_USERS` 中的账号，再锁定定义文件，最后才以 `PENGUIN_PINNED_AGENT` exec 出真正的
  服务端。
- **文件系统锁。** 每次启动都会把 `AGENTS.md`、`system_config.yaml`、`skills/`、`hooks/`、`tools/` 与
  `schedule/` 置为 root 所有且不可写，服务端以非特权用户 `node` 运行——这是唯一能拦住 Agent 自身文件工具
  的一层，而路由守卫看不到那条写入路径。`memory/` 与 `.vault.toml` 保持可写。
- **生成的 Dockerfile 现在能构建了。** `node-pty` 只发布 macOS 与 Windows 的预编译产物，因此在 Linux 上
  `npm install -g @prismshadow/penguin-cli` 会退化为 `node-gyp rebuild`，而 `node:24-slim` 镜像跑不了它：
  本次改动之前导出的每个 Docker 包都会在这一步失败。两种形态现在都在带 `python3 make g++` 的构建阶段
  编译 CLI，再把装好的 npm prefix 复制进精简运行镜像。
- **以固定模式启动一个已有数据根**时，其中其他的 Project 与 Agent 仍保留在磁盘上，只是不再被列出、也不再
  提供服务。两个方向都没有迁移动作。
