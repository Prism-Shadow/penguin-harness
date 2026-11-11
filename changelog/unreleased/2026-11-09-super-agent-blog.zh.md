# 博客新增 Super-agent 文章与两张手绘插图

- **Date:** 2026-11-09
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1513](https://github.com/Prism-Shadow/penguin-harness/pull/1513)

[English](2026-11-09-super-agent-blog.md)

博客新增双语文章 `designing-agents-to-replace-human-roles`：把 DeepSeek 内部的 Super-agent 架构当作「接管运行阶段」的样本。文章依次拆解三个机制——事件驱动：代码规则与模型两级过滤，后台静默复现 Bug 并提交 PR；双层架构：常驻 Router 维护全局上下文，把任务派给隔离的并发 Worker；Watchdog：主系统外的独立巡检 Agent 检查 Worker 进展，识别死循环或跑偏并介入修复——随后提出，设计 Agent 就是去找工作流里人还在亲手做的步骤，问一句能不能再加一层 Agent 把它吃掉；PenguinHarness 在评测与调优阶段做的是同一件事。

文章带两张交互插图，由 `packages/landing/src/blog-widgets/figure.tsx` 从 `data-widget` 属性挂载：一张架构拓扑图，三个机制依次点亮；一张三阶段演进图，从人主导一路扫到 Agent 主导。两张图在减弱动效偏好下都保持全亮静止。
