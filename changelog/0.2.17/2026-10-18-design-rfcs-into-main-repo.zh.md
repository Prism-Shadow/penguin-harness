# 设计 RFC 迁入主仓，落在 rfcs/ 下

- **Date:** 2026-10-18
- **Type:** process
- **Scope:** `docs`
- **PR:** [#1228](https://github.com/Prism-Shadow/penguin-harness/pull/1228)

[English](2026-10-18-design-rfcs-into-main-repo.md)

新增 `rfcs/` 目录，收下项目的设计 RFC，迁自设计仓库 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design)：已落地于其默认分支的十份，PRFC 编号与文件名原样保留。仍被 open 或 draft 设计 PR 携带的十份草案，随它们各自的 PR 进来。

## 细节

- 每份迁入的文档保留原标题、元数据列表与正文不变，只加两样：标题行下的来源标记——设计仓里的原文件名与它在设计仓的状态（落地于默认分支，或携带草案的 open/draft 设计 PR）以及当前 rev——与文末的 `## Changes` 一节，自 `v1.0.0` 起。
- 每份 RFC 落为中英一对：`PRFC-NNNN-slug.md` 英文与 `PRFC-NNNN-slug.zh.md` 中文，互相链接。中文取设计仓原文，英文为其英译。
- 目录入口说明（`rfcs/README.md` 与 `rfcs/README.zh.md`）写明这个面随之固化的四条约定：一份 RFC 与它对应的 impl 改动不放在同一个 PR 里；RFC 落地后不频繁修改；修改必须提升 rev（形如 `v2.0.0`）；每次修改在 `## Changes` 里列出该版本的 change item。
- 编号原样沿用。两份草案同占 `0005` 号（`PRFC-0005-mechanisms-not-implementations.md` 与 `PRFC-0005-plugin-versioning.md`）——两条独立的设计线，以文件名区分；`0013` 号已退役（HMR RFC 落地前改号为 `0002`）。
- open 设计 PR 对已落地文档带而未合的修订（[penguin-harness-design #279](https://github.com/Prism-Shadow/penguin-harness-design/pull/279) 对 PRFC-0003 的「link 启用本地插件」修订），迁入文档保留落地版本，来源标记记录该未合并修订。
- 不改任何产品代码与测试。新增的自动化只有 `check-rfcs` 工作流，在 PR 触碰 `rfcs/` 时运行。
