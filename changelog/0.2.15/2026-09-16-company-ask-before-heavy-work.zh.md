# 公司模式：招募一律用同一个 Model、重负载或不可逆的事先请示董事会，以及科研协议

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `skills`, `server`, `web`, `landing`, `docs`
- **PR:** [#750](https://github.com/Prism-Shadow/penguin-harness/pull/750)

[English](2026-09-16-company-ask-before-heavy-work.md)

改动了 `agent-company` 插件（现为 `2026.09.16.1`）、手册模板与 CEO 的初始化运行：新组织的 CEO 只提案角色与预算——除非董事会指定了特定 Model，每名员工都用组织的 Model，组织未指定时用 Project 的默认 Model；并且每名员工在动到用户机器、花钱或触及组织之外的事之前，都先在全员频道向董事会请示并等待答复。新增了面向科研组织的 `company-research` Skill，并围绕它重写了科研使命示例。

## 细节

- `company-ceo`、`company-hr`、`company-finance` 与 `company-setup` 不再引导 CEO 按角色挑 Model：`penguin org hire` 不接受 Model，招募计划只写角色与预算，给某个角色指定 Model 成了由 CEO 带给董事会的决定。招募路径本身保持原样——没给 Model 的员工在组织图里没有 `model` 项，其工位会话与工单会话用组织的 Model，组织未指定时在各自打开的那一刻解析 Project 的默认 Model——服务端测试钉住了这两种情形。
- `company-employee` 新增「What you may not decide alone」一节——按动作触及的对象分四条规则：先请示董事会并等待（重负载或长时间计算、花钱与对外、公共工作区之外的任何写入、不可逆操作、缺少的凭据）；向上级提案、由 CEO 带给董事会（角色、预算、Model、拒绝工单、手册规则、组织结构）；先通知再做（已批准计划之内比较显眼的步骤）；直接做（自己分区里的日常工作）——以及「Asking the board」一节：在全员频道发一条 @ 创建者的消息，写清要跑什么、预计时长与资源、怎么停、替代方案，随后 `penguin org ticket block … --by user:<id>` 并结束本轮。`company-ceo` 让 CEO 同样受这份清单约束，并禁止其替董事会作答。
- 手册模板双语新增「动到机器或组织之外的事，先问」一节，「决策属于董事会」一节写明默认 Model 规则；CEO 的初始化正文点明这两条规则与科研分支。
- `company-research`：先固定评测脚本与指标；只改一个文件、每次实验同样的时长预算、带 `keep` / `discard` / `crash`、与运行日志一样不入 git 的 `results.tsv`、只保留有提升的改动、超过两倍时长即杀掉、从日志尾部诊断崩溃；循环开始前向董事会申请资源额度（机器、并发、总量、磁盘与数据、密钥），要超出就再申请；由不同员工担任的作者与审稿人对抗评审（每一轮由作者用 `penguin org ticket start --agent-id` 为审稿人开审稿会话）——带评分的审稿意见、逐条回应、三轮上限后升级到 CEO 再到董事会——全部落在既有的 `review` 列、`blocked` / `blocked_by`、进展行与频道之上。
- 科研使命示例（`S.company.missionExamples.research`，中英）点明实验循环、资源申请与对抗评审；文档站与官网的 Skill 列表、`plugins/README.md` 与插件清单列出第七个 Skill；公司模式文档描述了这道关卡与科研组织。
- 既有组织的手册保持原样；其员工通过对账扫描（把落后于插件库版本的插件整包重装）拿到改动后的 Skill。
