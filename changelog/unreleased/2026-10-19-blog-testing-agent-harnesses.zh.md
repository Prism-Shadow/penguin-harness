# 博客文章：用脚本化边界和不变量测试 agent harness

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[English](2026-10-19-blog-testing-agent-harnesses.md)

博客新增一篇中英文技术文章，讲 PenguinHarness 如何在 CI 中检查请求组装，以 `packages/core` 里的 `prompt-cache-*` 测试套件为例。

## 细节

- `testing-agent-harnesses`（分类 `practice`）从促成这些套件的回归讲起，即 [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 修复的压缩请求思考等级问题，然后介绍 [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) 加入的测试系统：真实的 Session 和模型客户端运行在脚本化的供应商流之上，每个录制下来的请求分别由字节诊断和按 Anthropic 公开缓存规则实现的模拟器读取，再由一条带命名豁免清单的不变量判定。随后对比没有采用的设计（调用线上 API、只校验字节、固定 Token 计数、改基线到变绿），结尾给出运行套件的命令。
- 文中的数字都来自套件自带的辅助模块，在项目的测试机上运行，不调用任何模型 API：套件的运行耗时，思考等级调整后和一次无害提示编辑后的 Token 计数，以及在两个场景下回滚 #700 后压缩请求的估算成本。
- 七张图以内联 SVG 绘制，使用 [#1217](https://github.com/Prism-Shadow/penguin-harness/pull/1217) 的共享图样式：静默回归、请求中直到缓存断点的各个块、测试流程，以及四组未采用方案与所选方案的对照，最后一组把成本画成同一比例尺上的条形。图中的每段文字都取自该语言版本的正文。
- 文章用编号脚注（GFM `[^n]`）标注出处，点击跳到文末带链接的参考资料列表，中英两版编号一致。
- 落地页博客测试把这篇文章列在技术实践分类的首位。
