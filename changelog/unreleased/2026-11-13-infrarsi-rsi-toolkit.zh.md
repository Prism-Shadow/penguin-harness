# InfraRSI 工具包用上游引擎加速训练任务

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community #71](https://github.com/Prism-Shadow/penguin-harness-community/issues/71)

[English](2026-11-13-infrarsi-rsi-toolkit.md)

新增 `infrarsi-rsi-toolkit`，用 [InfraRSI](https://arxiv.org/abs/2611.11558) 加速已有的训练任务。负责人：[Nhckdvrl](https://github.com/Nhckdvrl)。

## 运行方式

- Skill 按固定 commit 获取上游引擎及其 `infrarsi-optimize` Skill，在项目之外构建。上游没有许可证文件，因此插件不包含上游的代码或文字。
- Agent 原样遵循上游 Skill：与用户拟定任务约定，启动引擎并让它持续运行。引擎测量参考运行及其噪声，搜索启动参数与代码补丁，把最优者与原任务背靠背重跑，并写出报告。
- 引擎的每个请求都交给 `infrarsi_answerer` Agent 的一个新 `run_subagent` 会话，使用本会话的模型。该 Agent 只有 `read_file`、`write_file` 与 `exec_command`，规则只允许用 shell 打印请求目录中的文件：`read_file` 会截断超过 2000 个字符的行，而引擎把每个请求的 prompt 写成一行。
- `infrarsi agent next` 的等待时间控制在命令工具的两分钟上限之内。用户同意之前，不会改动用户的代码。

## 打包

插件在 `src/index.ts` 中声明卡片与 Skill（`preinstall: false`），已登记到 server、CLI、桌面端与 landing 打包、中英文插件目录、Skill 文档和官网算法清单。插件带有库内其他 Skill 插件同样运行的 SKILL.md 解析检查。
