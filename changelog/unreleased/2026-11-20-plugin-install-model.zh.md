# 插件的服务端安装与 Agent 安装各有一个控件，安装从不卡住

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `scripts`

[English](2026-11-20-plugin-install-model.md)

插件页卡片以两个带名字的控件取代并列的「安装」与「管理安装」：「服务端」安装到服务端或从服务端卸载，「安装到 Agent」打开各 Agent 的安装弹窗。从服务端卸载会先从这台服务端的所有 Agent 卸载，确认写明受影响的 Agent 数与名称；把服务端还没有的插件装到 Agent 会先安装到服务端，成员点击则改为向管理员请求。服务端安装的进度显示在所点的控件上，按钮不再冻结；失败时卡片下方写明原因，并给出下一步。

## 细节

- **「服务端」控件**：市场里的包为「安装到服务端」，装上后为「从服务端卸载」；成员看到置灰的控件，悬停说明只有管理员能改动服务端。随构建自带的插件不能从服务端卸载，标签的悬停说明写明这一点，带服务端模块的由管理员为本 Project 启用或停用该模块。
- **从服务端卸载**：`DELETE /api/admin/plugins?package=…`（管理员）先对这台服务端每个 Project 的每个 Agent 卸载该插件（含本地改动与 Workbench 的数据），再把它移出各 Project 的本机表，最后卸载包。`GET /api/admin/plugins/holders?package=…` 列出受影响的 Agent，确认里最多列出五个，其余合计。有 Project 的共享表列出它时拒绝（`409 plugin_shared`），随构建自带的拒绝（`409 plugin_shipped`）。机器选择器选中一台机器时经代理在那台机器上执行。
- **服务端还没有时装到 Agent**：弹窗开头先说明与服务端的关系。管理员点「安装」先安装到服务端，各步骤显示在该行上，随后装到 Agent；成员点击则记一条请求（`POST /api/projects/:projectId/plugins/modules` 带 `package`），管理员的请求列表在包装上服务端之前不允许「启用」。
- **安装事件流**：发出 `stage` 事件（每个尝试的来源，以及重新装配前的 `loading`），也发出此前从未发出的渠道下载进度 `download`；每 20 秒一次的 `ping` 使事件流 40 秒的空闲断开不再切断仍在进行的安装。答复至多等待重新装配 60 秒，启动更久的模块报告为仍在启动（`loading`）。
- **失败说清原因**：npm 以 `--fetch-timeout=60000 --fetch-retries=1` 运行；registry 上没有的包答复 `400 plugin_not_published`（「…尚未发布到 <registry>」），registry 无答复为 `400 plugin_source_unreachable`；安装时查询索引每个地址只试一次、10 秒为限。卡片下方的说明附「插件源设置」与「从文件导入」。
- **随构建携带的离线包**：仓库中列在内置索引、却不随构建自带的插件由构建打包放在 builtin 前缀旁的 `offline/`，记下 sha512；registry 没有该包、不可达或本机没有 npm 时，市场在校验后从这份离线包安装；工作区检出时改为现场打包仓库自己的插件。离线包不预装、不加载。市场条目带 `offline`，卡片因此在安装前就知道这类插件带什么。
- **UI 包**：`ImpactList` 在危险操作的确认里列出它会波及什么，组件画廊的 data 画板展示它。
