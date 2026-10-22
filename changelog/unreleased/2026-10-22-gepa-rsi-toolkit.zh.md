# GEPA 以 `gepa-rsi-toolkit` 加入 RSI 工具包

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `plugins`, `core`, `docs`, `landing`, `ui-gallery`
- **PR:** [#1277](https://github.com/Prism-Shadow/penguin-harness/pull/1277)

[English](2026-10-22-gepa-rsi-toolkit.md)

插件库新增第六个 RSI 工具包 `gepa-rsi-toolkit`（GEPA RSI Toolkit，分类 `rsi`，预装）。它唯一的 Skill `gepa-rsi-toolkit`（`2026.10.22.1`）对照 `gepa-ai/gepa` 的 `8f287de942f41a6d1e0e7e5b2d576247c4bedee9` 运行 GEPA（[Agrawal 等，2025](https://arxiv.org/abs/2507.19457)），在只有一条指令的系统上采用 `optimize` 的默认设置：父代从逐题 Pareto 前沿抽取，每次取 3 道反馈题组成小批量，反思模型阅读父代的 Trace 与分数并写出新指令，子代只有在小批量总分严格更高时才被接纳，每个被接纳的子代都做一次完整测量，最后保留平均分最高者。Web App 无需改动，「优化」标签页的**方法**字段即可选到它，因为这份列表读自插件库的 `rsi` 分类。

## 细节

- **指令槽。** 初始化在 Target 中加入 `skills/gepa-instruction/`，内含 `instruction.md`（用户给出的种子指令，否则为空），并在 `AGENTS.md` 中加一行固定的读取指令，与 OPRO、APE 工具包的形式相同。
- **题目集合。** `benchmark_id` 提供反思模型阅读的反馈题。可选的 `pareto_benchmark_id` 提供 Pareto 题，候选池中每个成员都在这些题上测量和选择；不提供时两者是同一批题，与 `optimize` 不传 `valset` 时一致。可选的 `test_benchmark_id` 只在选定之后测量。
- **抽取。** `scripts/draw.py`（Python 3，仅用标准库）按源码的顺序，从同一条 `random.Random(0)` 随机流中抽取每一轮的父代与小批量，并把随机流的状态保存在本次运行的输出目录里，会话恢复后接着同一条流继续。在随机生成的候选池上与源码的 `select_program_candidate_from_pareto_front` 和 `EpochShuffledBatchSampler` 对照，两者抽出的父代与小批量完全一致。
- **提示词。** 反思提示词逐字采用 `InstructionProposalSignature.default_prompt_template`；小批量里的每次执行按源码渲染记录的方式写成 `Inputs`、`Generated Outputs`、`Feedback` 三段，回复按 `ProposalAdapter.parse` 的方式解析。
- **预算。** Target 的每次执行都计入 `max_metric_calls`，并像源码一样在每轮开始前检查。冒烟默认值是种子的一次测量，加上四轮未接纳任何子代的迭代。
- **声明的改动。** 由于 Rubric 不公开，反馈只有 Rubric 分数；反思模型按路径阅读每次执行的 Trace 与 Workspace；分数取 `0..100`，因此 `perfect_score` 为 100；Merge 不运行，因为只有一条指令时它只会复现某个父代。
- **评测。** 该工具包附带的 `references/evaluation.md` 与其他算法工具包逐字节相同。
- **包。** `core`、`cli` 与 `desktop` 依赖 `@penguinharness/gepa-rsi-toolkit`。落地页的算法一行、README 表格、技能与插件、自我进化、评估中心、组件库的插件库与 Web App 的技能端到端测试都列入了它。
