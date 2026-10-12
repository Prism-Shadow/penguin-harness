# GDPevo Train 与 GDPevo Test 加入内置 Benchmark

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `landing`, `docs`, `skills`
- **PR:** [#1064](https://github.com/Prism-Shadow/penguin-harness/pull/1064)

[English](2026-10-12-builtin-gdpevo.md)

新建的 Project 在 Sec A 到 Sec E 之外，又多了两个内置 Benchmark：**PenguinHarness Benchmark GDPevo
Train**（`penguinharness-benchmark-gdpevo-train`）与 **PenguinHarness Benchmark GDPevo Test**
（`penguinharness-benchmark-gdpevo-test`）。它们是 Prism-Shadow/penguin-harness-benchmark 中 GDPevo
子集的两半：六个公司环境里来自真实岗位的业务任务，训练题用来优化 Agent，同样环境里留出的测试题用来评估
它。和其他内置 Benchmark 一样，产品里只有文字；任务文件夹、业务环境和所有大文件都留在那个仓库里。

## 细节

- **Project 得到什么。** 两个都以 `runs = 1`、`status = "published"`、无评估写入，各 30 道题，题目
  目录为 `CASE-NNN-tg<组>-<划分>-<编号>`。文件与 benchmark 仓库在 `packages/` 下发布的 `2026.10.12.1`
  版逐字节相同，内置副本与导入的副本因而一致；`scripts/benchmark-packages.mjs` 也开始写出这两个包。
- **题干。** 每道题干都链接任务文件夹、仓库的运行规则，并从提交 `3389565` 的检出运行，即写出这两个包
  的那个提交。启动命令只放行模型服务的 API 主机，因为 GDPevo 的答案是公开的；分数是上游评分器给出的
  0 到 1 之间的分值乘以 100，部分正确的答案得部分分数，评分细则写明由评分器判分。
- **core 数据。** 内置 Benchmark 改为各自携带固定的提交，并可另带实测结果页、任务在上游的位置与评分器的
  分值说明；Sec A 到 Sec E 沿用原有的值，文件没有变化。
- **官网。** 首屏的「评估集」一行把 GDPevo 列为一项，即「Agent 自进化」（英文 "Agent self-evolution"），
  链接到 GDPevo 仓库。
- **文档与 Skill。** 评估中心页面列出这两个 Benchmark，说明它们如何配合使用、部分得分与 GDPevo 的校准
  结果，并说明已有 Project 缺少某个内置 Benchmark 时如何导入；自我进化页面与 `benchmark-design` Skill
  的包格式参考（`2026.10.12.1`）不再写内置 Benchmark 的个数。

## 已有的 Project

早先版本创建的 Project 不会得到这两个 GDPevo Benchmark。和以前一样，从 benchmark 仓库导入包文件夹即可
补上。
