# QA 场景任务：QA Agent 对真实安装执行的任务

- **Date:** 2026-10-05
- **Type:** process
- **Scope:** `tests`

[English](2026-10-05-qa-scenarios.md)

`tests/scenarios/` 存放 QA 任务，一个任务一个目录，其中的 `TASK.md` 就是交给 QA Agent 的 prompt。

- `tests/scenarios/README.md` 定义任务格式：frontmatter 写 `title`、`starts_from`（`scratch`，或从另一个任务结束时的环境接续）、`inputs`、以分钟计的 `cost` 与 `platforms`；正文固定五节 Goal、Steps、Record、Done when、Never。README 还约定一轮中每个任务交付什么（单文件 `report.html`、`shots/`、`evidence/`、`issues.md`，UI 类任务另有 `oplog.md`，均放在仓库之外），以及任务留给后续任务的 `handover.md`。
- 首批三个任务：`install/from-ref` 在给定的 release、tag 或 revision 上从零安装并启动 server；`ui/explore` 先按固定路径、再自由地走一遍 Web App；`ui/changelog` 在运行中的产品里逐条核对被测 ref 的 changelog。
