# 通过插件接缝注册的已安装工作流

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

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

每条路由都要求**管理员**会话，读取也不例外。脚本在服务器进程内、以服务器的权限运行，
因此安装是一项运维动作：能把工作流装进自己所在 harness 的 agent，本身就是一个提权洞。

`penguin-sdk` skill 记录了完整契约——鉴权、脚本形状、安装、验证与维护。

## 脚本契约

脚本体返回 `{ name, version, run }`，`setup` 与 `park` 可选。安装时求值一次，因此不满足
契约的脚本会当场退回给安装者，而不是在之后某次启动时才暴露，并且该次安装会从磁盘回滚。

- `setup(ctx)` 注册工具。工具是 `{ name, description, run }`，注册时校验，归属于提供它的
  工作流，随该工作流一同撤下。已被其他工作流占用的名字会被拒绝，绝不遮蔽。
- `run(input, ctx)` 收到一个运行上下文，其 `runAgent(prompt)` 用于驱动 agent。接缝已就位，
  生产环境暂未配置实现，调用它的工作流会得到明确告知，而不是以晦涩的方式失败。
- `park()` 返回下一个实例据以恢复的状态，在工作流注销时写入磁盘。

## 工作流何时是活的

工作流归属于某个 agent，只在该 agent 活跃期间注册：其工具随 agent 第一个会话开启而加入
工具集，随最后一个会话关闭而离开，退出时 `park()` 落盘。激活按引用计数，因此多个会话可以
同时持有同一个 agent。没人在对话的 agent 不贡献任何东西。

为活跃 agent 安装会立即注册；为空闲 agent 安装则先存盘，等待下一次激活。

## 推送之后留下什么

脚本及其状态位于 `<agent>/agent_state/workflows/<workflowId>/`，在 platform bundle 之外，
推送不会触碰它们。哪些 agent 是活的，与终端句柄 id 一同驻留在 platform 文档中，新的 App
精确地重新注册这些——没有这一步，一次推送会让工具集变空而安装看起来仍完好。脚本已消失或
不再有效的引用会被报告并跳过，其余照常加载。没有任何环节去枚举 agent。

## Web App 中

带 UI 的工作流在 Chat 旁以独立标签页出现，以其 UI 树的内容哈希为键，因此打开的标签页能
察觉一次重装。Chat 始终可达：工作流消失时，其标签页回退到 Chat。
