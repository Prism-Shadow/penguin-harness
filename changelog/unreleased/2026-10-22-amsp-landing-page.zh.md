# 官网新增 AMSP 页面 /amsp

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1297](https://github.com/Prism-Shadow/penguin-harness/pull/1297)

[English](2026-10-22-amsp-landing-page.md)

penguin.ooo/amsp 仿照 mmsp.penguin.ooo，用一个页面介绍 AMSP，即 PenguinHarness Agent 的 Session 流。页面开头是 AMSP 标志、协议的全称和主张，旁边的播放器逐步重放一次运行；随后画出一次运行的三层边界，列出全部记录与控制帧，给出三步跑起第一次运行的示例，最后链接到协议参考。

## 细节

- **标志。** AMSP 标志按 MMSP 的同一套构造绘制：同样的四块方格、颜色与字重，蓝色落在另一条对角线上。它出现在首屏与分享卡片上。
- **播放器。** 三个标签页重放同一个 Session 上的三次脚本运行：首次请求、继续对话，以及调用方中途打断的一次追问。左栏按到达顺序列出流：`hello` 帧、各条记录（写入 Trace 的带浅色底）、调用方的中止请求与 `[DONE]`；右栏把运行拼装起来：Agent 与（首次请求时的）模型、归在各 Request 下的消息及该 Request 的思考等级，最后是由记录读出的结果、Request 数、耗时和用量条形图。重放按运行自身的时间戳推进，只在播放器可见时播放，可以暂停；减少动态效果时直接显示完成状态。
- **各节内容。** 一张图画出 `task_begin … task_end`、`request_begin … request_end` 以及片段收尾为完整记录，并标出工具输出在 `request_end` 之后才完整；按信封 `type` 分组的记录表，标明 `session_meta` 只随首条消息上流，另列四种控制帧；基于 `/api/amsp/v1` 与 `@prismshadow/amsp` 0.3.0 的 curl 和 TypeScript 快速上手；协议参考、OmniMessage、Agent API 使用指南、npm 和源码的链接。
- **每类内容只在一处。** 记录表与控制帧在 `src/lib/amsp-vocabulary.ts`，代码示例在 `src/lib/amsp-quickstart.ts`，脚本运行在 `src/lib/amsp-demo.ts`；在 SDK 0.3.0 提供这些类型之前，它们基于页面自带的协议类型。
- **站点。** 顶栏在「下载」和「文档」之间加入「AMSP」，页脚「产品」一栏也加入该链接。页面单独打包、按需加载；标签页标题和描述随读者语言切换，静态外壳带有页面自己的标题、描述和分享卡片（`public/og-amsp.png`，由 `node scripts/capture-og-cover.mjs amsp` 生成），分享链接时显示页面自己的名称。`/amsp/` 已加入站点地图。
