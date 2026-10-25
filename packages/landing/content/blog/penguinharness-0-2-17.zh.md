---
title: "PenguinHarness 0.2.17：统一 Agent 通信协议，优化远程机器和轨迹观测"
date: 2026-10-26
category: news
excerpt: "Agent API 现在流式输出 Session 记录，回复里可以出现统计图和表单，「轨迹观测」面板已重做，远程机器上的对话会读取那台机器上的数据。"
---

PenguinHarness 0.2.17 发布了。**Agent API 的流现在就是 Session 自己的记录，回复里也能出现统计图块和表单块**。「轨迹观测」面板已重做，远程机器上的对话会读取那台机器上的数据。

## Agent API 流式输出 Session 自己的记录

**这个流现在就是 Session 自己的记录，与 Trace 中的存储完全一致**。旧的 v1 事件已移除。`@prismshadow/amsp` SDK 读取的就是这些记录。程序现在可以持续跟踪一个不是自己启动的 Session，读取历史，接上流，还能看到等待审批的工具调用。Web App 里 Agent「API」标签页上的「试一试」现在通过 SDK 运行，并列出这次运行的记录。

![Agent「API」标签页中列出记录的「试一试」区域](/blog-assets/penguinharness-0-2-17-agent-api-zh.png)

## 回复里的统计图和表单

**回复新增 `chart` 块，支持折线图、面积图、柱状图、饼图、散点图、直方图和仪表盘**。还有一个 `resources` 块，显示一台机器的 CPU、内存、磁盘和网络。

![一条回复，带分组柱状统计图和 resources 块](/blog-assets/penguinharness-0-2-17-a2ui-charts-zh.png)

表单现在有 11 种字段类型，从文本、数字到滑块、开关和日期。填过的表单在页面重新加载后仍会显示答案，旧对话里也一样。请更新 `a2ui` 插件，这样 Agent 就能输出新的统计图块和表单字段。

![表单填写后重新加载，答案以只读方式显示](/blog-assets/penguinharness-0-2-17-a2ui-form-zh.png)

## 重做后的「轨迹观测」面板

**「轨迹观测」面板围绕一个固定工具栏重做**。轮次按钮显示当前查看的轮次，点开是「轮次导航」。每个轮次显示为带分隔线的行，行内的上下文圆环点开显示该轮次的 Token 用量（「本轮读数」）。视图会在每个请求的思考等级变化处显示该等级。

![「轨迹观测」面板，含工具栏、带分隔线的轮次行和上下文圆环](/blog-assets/penguinharness-0-2-17-trace-zh.png)

退出码非零的命令现在在这个面板、聊天界面和 CLI 里都显示为一次已完成的普通工具调用。

## 远程机器上的对话读取那台机器

远程机器是服务器通过 ssh 访问的另一台计算机（「机器管理」页面）。「智能体」页面在本服务器的 Agent 旁边列出每台已连接机器上的 Agent。你可以在那台机器上打开、编辑和删除它们，并与它们对话。

![「智能体」页面在本服务器的 Agent 旁边列出一台机器的 Agent](/blog-assets/penguinharness-0-2-17-machines-zh.png)

**机器上的对话读取那台机器的记忆、模型、定时任务和 Skill**。

## 升级须知

- **Windows 桌面应用**：安装包现在用新证书签名，0.2.16 及更早版本的应用会拒绝这次更新。请先从 penguin.ooo/download 手动安装一次 0.2.17，之后的更新照常进行。
- **Agent API 和 SDK 调用方**：流的格式变了，记录类型也改了名。服务器和 `@prismshadow/amsp` 要一起升级；[发布说明](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17)写明了改动内容和应对方法。
- **负责 TLS 终止的反向代理**：设置 `PENGUIN_TRUST_PROXY=1`，否则 Web App 的所有写操作都会被拒绝。代理配置见[发布说明](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17)。

安装包见 [penguin.ooo/download](https://penguin.ooo/download)，完整变更见 [0.2.17 更新日志](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17)。
