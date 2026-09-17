# The Evaluation Center's score label is translated in the Chinese interface

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** `web`
- **PR:** [#760](https://github.com/Prism-Shadow/penguin-harness/pull/760)

[中文版](2026-09-16-benchmark-score-label.zh.md)

The Chinese interface left one Evaluation Center label in English: "Score" headed the score column
of the evaluation table and of the per-case table in the evaluation dialog, named the score in that
dialog's metric row, and made the chart title read "Score随时间变化". It was translated as 分数, the
word the other Chinese score labels already used (最新分数, 目标分数), and the chart title became
分数随时间变化.

The Ask AI dialogs still called the same number 得分: in the description of "Ask AI about this
evaluation", in an example button of "Ask AI about this case" and in the prompts both prefill, as did
the prompts that Create with AI and Evaluate prefill. Each became 分数, except where it named the
per-case list handed to the agent, which became 逐题结果.
