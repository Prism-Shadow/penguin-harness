# 官网新增 AMSP 页面 /amsp

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1297](https://github.com/Prism-Shadow/penguin-harness/pull/1297)

[English](2026-10-22-amsp-landing-page.md)

penguin.ooo/amsp 仿照 mmsp.penguin.ooo，用一个页面介绍 AMSP，即 PenguinHarness Agent 的 Session 流。页面开头与 mmsp.penguin.ooo 一致：AMSP 标志、协议的全称、主张「Agent 通信统一协议」和副标题「用同一种协议流式传输、解析和存储 Agent 消息」，旁边的播放器逐步重放一次运行；随后用条形图画出消息结构，逐个字段说明每种记录，给出运行 Agent 的方法，最后链接到协议参考。

## 细节

- **标志。** AMSP 标志按 MMSP 的同一套构造绘制：同样的四块方格、颜色与字重，蓝色落在另一条对角线上。它出现在首屏与分享卡片上。
- **播放器。** 三个标签页重放同一个 Session 上的三次脚本运行：首次请求、继续对话，以及调用方中途打断的一次追问，被打断的回复以一条包含已到内容的完整文本收尾，其 Request 以 `aborted` 结束。这些运行沿用真实 Agent 运行的时间（首个 Token 在一秒多之后出现、思考几秒、`date` 调用约五分之一秒）；首次请求的回答分成两个 `delta` 流出，文本在句中断开，其余消息各一个 `delta`，因此一次运行的每一步都能同时显示，每步一行、行高 20 像素：开头的 `ping`、按类别着色的各条记录（`model_msg` 为蓝色，`event_msg` 为与 Web App 的 Trace 视图一致的琥珀色；写入 Trace 的带浅色底）、调用方的中止请求与 `[DONE]`。各栏沿用 MMSP 的标题与外观：代码区「只需要一份代码」（import、空一行、客户端与调用）、「流式事件传输」与「消息解析结果」。右栏把运行拼装起来：Agent 与（首次请求时的）模型、归在各 Request 下的消息及该 Request 的思考等级，最后是按 SDK 的 `RunResult` 规则由记录读出的结果、Request 数、耗时和用量条形图。重放按运行自身的时间戳推进，节奏放慢到读者跟得上（服务器同时发出的记录逐条出现，较长的等待被缩短），只在播放器可见时播放，可以暂停；减少动态效果时直接显示完成状态。
- **各节内容。** 一张条形图在同一条时间轴上按时长从长到短画出消息结构：琥珀色的 Task（`task_begin … task_end`）与 Request（`request_begin … request_end`），以及填满每个 Request 的各条消息，以浅色呈现 Web App 的 Trace 视图对各种类所用的色相（思考为紫色、模型回复为天蓝色、工具调用生成为橙色、工具调用执行为翠绿色），每条止于它的完整记录，以该色相的深色标出，示例是一次包含两轮工具调用、三个 Request 的运行；空档只出现在相邻 Request 之间，工具在其中运行，它的输出在那里完成；记录参考：外壳、按类别排列的每种记录和控制帧（`ping`、`data: [DONE]`），一次展示一种，各配一个包含全部字段的示例和一张字段表（类型、必填或可选、含义、示例值），嵌套字段也在其中；运行 Agent 的方法，基于 `/api/amsp/v1`，默认展示用 `@prismshadow/amsp` 的 TypeScript（`stream()` 读取记录，`run()` 获取结果），旁边是 curl，并附有首屏那个复制给编码 Agent 的提示词的按钮；协议参考、AMSP 记录、Agent API 使用指南、npm 和源码的链接。
- **每类内容只在一处。** 记录的类别与控制帧在 `src/lib/amsp-vocabulary.ts`，记录参考的示例与字段在 `src/lib/amsp-records.ts`，代码示例在 `src/lib/amsp-quickstart.ts`，脚本运行在 `src/lib/amsp-demo.ts`；在已发布的 SDK 提供这些类型之前，它们基于页面自带的协议类型。
- **站点。** 顶栏在「下载」和「文档」之间加入「AMSP」，页脚「产品」一栏也加入该链接。页面单独打包、按需加载；标签页标题（与 MMSP 同样的格式「AMSP：Agent Message Stream Protocol」）和描述随读者语言切换，静态外壳带有页面自己的标题、描述和分享卡片（`public/og-amsp.png`，由 `node scripts/capture-og-cover.mjs amsp` 生成），分享链接时显示页面自己的名称。`/amsp/` 已加入站点地图。
