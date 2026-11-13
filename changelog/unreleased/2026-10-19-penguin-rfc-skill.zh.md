# 一个写设计 RFC 的 skill

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`

[English](2026-10-19-penguin-rfc-skill.md)

新增 `penguin-rfc` skill：agent 在 `rfcs/` 下写、审、改设计 RFC 的标准路径——判断何时需要一份 RFC、从模板起草、取编号、把 RFC 与它的实现分在两个 PR、应答评审，以及修改已落地的 RFC 时升 rev。

## 细节

- skill 位于 `.agents/skills/penguin-rfc/SKILL.md`，与仓库其余开发用 skill 同处；不进随仓库分发的插件库。
- 它把 `rfcs/README.md`、`.github/CONTRIBUTING.md` 的 RFC 章节与 `rfcs/TEMPLATE.md` 里的规则收成一份操作摘要，并逐条说明 Check RFCs 的失败与修法。
- 它假定 RFC 面先落地：它指向的路径（`rfcs/`、模板、Check RFCs 工作流）今天只存在于那条 RFC 改动的分支上。
