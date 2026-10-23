# 官网新增 AMSP 页面 /amsp

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `landing`, `amsp`

[English](2026-10-22-amsp-landing-page.md)

penguin.ooo/amsp 仿照 mmsp.penguin.ooo，用一个页面介绍 AMSP v2。页面开头是协议的全称和主张，旁边的播放器逐条重放一次运行；随后画出一次运行的三层边界，列出全部记录与事件，介绍两条流、两扇门和 SDK，给出三步跑起第一次运行的示例，最后链接到协议参考。

## 细节

- **播放器。** 三个标签页各重放一次脚本编写的运行：工具调用、审批模式下的同一次调用，以及接着第一个 Session 的直接回答。左栏按到达顺序列出事件，写入 Trace 的记录带浅色底；右栏把运行拼装起来：各条消息归在所属 Request 下并标出该 Request 的思考等级，最后是 `task_end` 的状态、Request 数、耗时和用量条形图。重放按运行自身的时间戳推进，只在播放器可见时播放，可以暂停；减少动态效果时直接显示完成状态。播放器下方注明模型由脚本扮演。
- **各节内容。** 一张图画出 `task_begin … task_end`、`request_begin … request_end` 以及片段收尾为完整记录，并标出工具输出在 `request_end` 之后才完整；按信封 `type` 分组的记录与事件表；Session 流与用户流、Agent 密钥与登录会话两扇门、`AgentClient` 与 `SessionReader`，以及 v1 的退役；curl 和 TypeScript 两种快速上手；协议参考、OmniMessage、Agent API 使用指南、npm 和源码的链接。
- **每类内容只在一处。** 记录与事件表、两扇门和首屏的计数在 `src/lib/amsp-vocabulary.ts`，代码示例在 `src/lib/amsp-quickstart.ts`，脚本运行在 `src/lib/amsp-demo.ts`；在 SDK 1.0 提供 v2 类型之前，它们基于页面自带的 v2 类型。
- **站点。** 顶栏在「下载」和「文档」之间加入「AMSP」，页脚「产品」一栏也加入该链接。页面单独打包、按需加载；标签页标题和描述随读者语言切换，静态外壳带有页面自己的标题、描述和分享卡片（`public/og-amsp.png`，由 `node scripts/capture-og-cover.mjs amsp` 生成），分享链接时显示页面自己的名称。`/amsp/` 已加入站点地图。
- **README。** `@prismshadow/amsp` 的 README 加入该页面的链接。
