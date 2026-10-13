# Harbor 格子返回一格即补一格，trial 改从安装包安装

- **Date:** 2026-10-11
- **Type:** process
- **Scope:** `plugins`, `docs`
- **PR:** [#1034](https://github.com/Prism-Shadow/penguin-harness/pull/1034)

[English](2026-10-11-harbor-cell-fanout.md)

`agent-evaluation` 针对 Harbor 题的参考文件给调用方定下派格循环：在上限内以后台方式派出格子，派满即结束本回合，在完成通知开启的那一回合补派下一格。此前实测的 GDPevo 校准中，调用方改用 `input_subagent` 轮询，允许的 4 格平均只有 2.6–2.7 格在跑。共享准备还为每份检出构建一次基准仓库的安装包，trial 的 agent 准备阶段直接解包 Node.js 与 CLI（中位数 7 秒），不再联网安装（中位数 112–261 秒）。四个算法工具包的评测参考文件也写入了同样的规则。

## 细节

- **上限。** 调用方同时跑的格子数取用户为本次评测给出的上限，否则为四个，即基准仓库的规则：每个 trial 占用一个 Docker 网络，同一台机器上的几个评测分摊它的上限。上限从不超过八个，再多一个运行中的后台子会话，harness 就会拒绝派生。
- **派格循环。** `reference/harbor.md` §A「Running the cells」：每一格都以 `run_subagent` 加 `run_in_background: true` 派出，Prompt 首行写 `Caller agent: <id> — cell <case_id> run <run>`，完成通知因此能点出是哪一格。调用方维护一张台账，记下未派、运行中与已返回的格子，把空位派满后结束本回合，再在每条 `[background_task_done]` 通知开启的回合里补派，既不轮询，也不等整批返回。Docker 分不出网络的格子回到队首，上限减半后重跑。
- **安装包。** §A 新增第 10 步：调用方用仓库的 `tools/make_install_bundle.sh` 在检出里构建 `bundles/penguin-cli-<penguin version>-node-24.18.0-linux-<arch>.tar.gz`，构建期间持有一把 `mkdir` 锁，另一个评测最多等它 10 分钟；构建失败时不带安装包继续。§B.7 在文件存在时给启动命令加上 `--ak install_bundle="$BUNDLE"`；worker 从不自行构建。
- **Skill。** `agent-evaluation` 的 `SKILL.md` 为调用方概述了派格循环与安装包，`agent-optimization` 按「Running the cells」运行每个 Candidate 的格子。
- **工具包。** `opro-rsi-toolkit`、`ape-rsi-toolkit`、`ace-rsi-toolkit` 与 `awm-rsi-toolkit` 逐字节相同的 `references/evaluation.md` 以后台方式运行 Harbor 格子，上限相同，返回一格即派下一格；检出里有安装包时一并传入。
- **版本。** 改动的 Skill 升至 `2026.10.12.1`：`agent-evaluation` 插件的 `agent-evaluation`、`default-rsi-toolkit` 的 `agent-optimization`，以及 `opro-rsi-toolkit`、`ape-rsi-toolkit`、`ace-rsi-toolkit`、`awm-rsi-toolkit` 各自的 Skill。
- **文档。** 「评估中心」页的内置 Benchmark 一节写明了上限及其原因、一个 trial 结束即开始下一个，以及安装包。
