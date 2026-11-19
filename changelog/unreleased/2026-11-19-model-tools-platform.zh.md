# 插件可以为自己的工具绑定 Project 模型，并在对话轮次之外调用它们

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `db`, `docs`
- **PR:** [#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639)

[English](2026-11-19-model-tools-platform.md)

平台为提供模型工具（图像、视频、语音、搜索）的插件新增三个通用原语：把插件的工具绑定到已配置的模型；在对话轮次之外请求 Project 模型，并与对话同样计费；以及任何 Project 成员都能运行、可以收发文件的插件 CLI 命令。平台不出现任何工具或操作的名字，工具本身归插件所有。

## 绑定

- `.project_config.toml` 新增开放的 `[tools]` 表：`key = { provider, model_id }`，每个绑定一行。core 在 CLI 的读写之间原样保留它，不读取其中任何键。在模型页或用 `penguin config model remove` 删除模型时，指向它的绑定随之解除；模型改名时绑定跟随；「恢复默认」清空全部绑定。`vision_model` 不变。
- 插件在新的 `ToolModelBindingsProvider.bindings` 槽（由 `@prismshadow/penguin-server/plugin` 导出）中声明绑定：键、中英文名称，以及代码半 `accepts(model)`，用来说明哪些已配置模型可以承担它。插件模块经 `ToolModelBindings` 接口读取 Project 的选择。
- `GET /api/projects/:projectId/models/tool-bindings` 列出已声明的绑定及各自的模型与候选（成员可读）；`PATCH` 绑定或解除一个键（仅所有者）。变更以 `tool_bindings_changed` 推送给该 Project 的用户。
- `GET /models` 返回 `toolModels`，`PUT /models` 把它作为整张表接收。同步到机器时一并下发，机器上的绑定因此与本服务端一致。

## 对话轮次之外的请求

- core 的 `streamProjectModel` 用对话所建的同一种客户端向已配置的模型发出一次请求：使用该行的连接、PenguinHarness 的 User-Agent、端点的归属头与对话的空闲超时。它报告提供商给出的用量，MMSP 在已计费后拒收的响应也不例外。
- 服务端的 `ProjectModelRequests` 接口为插件模块封装它。每次请求写一行 `usage_records`，有 Session 时归属该 Session 与 Agent。该行在新增的 `purpose` 列中记下请求的用途（`<包名>:<操作>`），计价与其他请求相同。
- 与 Session 自身请求并行记录的请求，不再打乱该 Session 的请求记账。

## 插件 CLI 命令

- 命令的数据半可以写 `access: "member"`。这时调用方所在 Project 的任何成员都能运行它，为非管理员构建的程序只含这类命令。
- 一次运行携带调用方的 Project 与 Session（Agent 的 `PENGUIN_PROJECT_ID` 与 `PENGUIN_SESSION_ID`，成员命令缺省为 `default_project`）。服务端校验二者后，把 `caller` 交给命令。
- 命令可以声明 `files.read` 选项，由终端读取其文件并随运行发送；也可以声明 `files.write` 选项，终端把命令交回的文件保存在其下。保存时从不覆盖已有文件，每个保存的路径都打印到 stderr。
- 命令经 `ctx.stdout`、`ctx.stderr` 与 `ctx.exit` 输出。成员命令可以并发运行，管理员命令保留原有的进程输出捕获。
