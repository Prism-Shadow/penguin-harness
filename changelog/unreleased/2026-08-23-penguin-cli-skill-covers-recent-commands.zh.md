# penguin-cli skill 补齐 CLI 新增的命令

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`
- **PR:** [#415](https://github.com/Prism-Shadow/penguin-harness/pull/415)

[English](2026-08-23-penguin-cli-skill-covers-recent-commands.md)

`penguin-cli` 库内 skill 记录的还是 7 月下旬的 CLI，此后新增的四处命令界面对照着它工作的
Agent 完全看不见。这次一并补上（skill `v9`）：`penguin config model remove`、`model add` 上的
`--fast-mode` / `--no-fast-mode`，以及 `run` / `chat` 上的 `--thinking` 与 `--goal`。

## 细节

- `model remove` 加入其余 model 命令，连同它对 `(provider, model_id)` 的精确匹配、未配置该组合时
  的非零退出，以及删除后随之清空的默认模型 / 视觉模型指针。
- `--fast-mode` / `--no-fast-mode` 进入 `model add` 的命令行摘要与选项列表，和 `--vision` 一样是
  三态；也写明了对没有 fast 档位的 AgentHub 客户端会在 stderr 给出告警。
- "Running agents" 一节补上 `--thinking <level>`——它的回退链、在会话创建时定档因而被子 Agent
  继承、以及 `--resume` 下转为按轮覆盖的含义——和 `--goal [budget]`，包括 token 预算取值与
  `penguin chat` 里的 `/goal` 写法。
