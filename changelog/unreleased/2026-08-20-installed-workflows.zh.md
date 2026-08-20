# 通过插件接缝注册的已安装工作流

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`

[English](2026-08-20-installed-workflows.md)

工作流可以通过 HTTP 安装进正在运行的 harness，下一个请求即可调用，无需推送、无需重启。
一个已安装的工作流是带 `run` 函数的具名单元，存放在 agent 自己的目录下，注册进 App 的
工作流集合——插件注册的也是同一个集合，因此对下游而言两者是同一种东西。

## 接口

由 platform 通过 HTTP 接缝提供，因此整个接口随热推送发布和变更，而不必重新构建每一处安装。

- `GET /api/workflows` —— 当前 App 已注册的内容
- `POST /api/workflows` —— 安装或替换，需要 `projectId`、`agentId`、`workflowId` 和
  `script`，可选的 `ui` 文件以 base64 传入
- `DELETE /api/workflows/:projectId/:agentId/:workflowId` —— 卸载
- `POST /api/workflows/:name/run` —— 按脚本声明的名字调用
- `GET /api/workflows/:projectId/:agentId/:workflowId/ui/*` —— 该工作流自带的 UI 文件

每条路由都要求可识别的调用者。脚本在服务器进程内、以服务器的权限运行。

## 脚本契约

脚本体返回 `{ name, version, run }`。安装时求值一次，因此不满足契约的脚本会当场退回给
安装者，而不是在之后某次启动时才暴露，并且该次安装会从磁盘回滚。

`run` 每次请求调用一次；工厂在每次 App 创建时重新运行，因此持有状态的脚本每次启动都拿到
全新实例，一次热替换绝不会把半构建的实例带过去。

## 推送之后留下什么

脚本位于 `<agent>/agent_state/workflows/<workflowId>/`，在 platform bundle 之外，推送
不会触碰它。一个 App 携带哪些安装，与终端句柄 id 一同驻留在 platform 文档中，下一个 App
只重新加载这些——脚本已消失或不再有效的引用会被报告并跳过，其余照常加载。没有任何环节
去枚举 agent。
