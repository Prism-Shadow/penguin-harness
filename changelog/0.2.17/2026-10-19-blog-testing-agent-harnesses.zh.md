# 博客文章：不调用模型在 CI 中测试 Agent Harness

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[English](2026-10-19-blog-testing-agent-harnesses.md)

博客新增一篇中英文技术文章，讲如何设计一套检查 Agent Harness 的自动化 CI 系统，以 `packages/core` 里的 `prompt-cache-*` 测试套件为例；文章论证的是这套设计，不讲缓存怎么计算。

## 细节

- `testing-agent-harnesses`（分类 `practice`）是一篇分五节的议论文。先讲没有功能信号的 Harness 回归，再讲原则：只替换供应商数据流，中间运行真实的 Session、上下文引擎和模型客户端。随后三个设计选择各自与未采用的方案对照论证：脚本化边界对比线上调用，并说明 CI 在哪里运行这些套件（按改动涉及的文件选择、三个操作系统、测试任务不带密钥）；带命名豁免清单的不变量对比钉死的数值；直接报失败对比改基线，以故意回滚 [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 作为被抓到的回归。结尾给出运行套件的命令和文档链接。
- 文中的数字都来自套件自带的辅助模块，在项目的测试机上运行，不调用任何模型 API：套件的运行耗时、一次无害提示词修改后的 Token 计数，以及在两个场景下回滚 [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 后压缩请求的估算成本。
- 五张图以内联 SVG 绘制，使用 [#1217](https://github.com/Prism-Shadow/penguin-harness/pull/1217) 的共享图样式，沿用已发布的版本：静默回归、测试流程，以及三组未采用方案与所选方案的对照。讲缓存内部机制的两张图已删去。
- 文章以 TL;DR 开头，导语和每一节各有一句关键句加粗。来源以编号脚注标注，每段最多一处、每个来源只引一次：共十个来源，中英两版的来源与编号一致。
- 落地页博客测试把这篇文章列在技术实践分类的首位。
