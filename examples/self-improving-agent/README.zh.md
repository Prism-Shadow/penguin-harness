<!-- [English](README.md) | 简体中文 -->

# 示例：一个自我改进的 Agent（本地，经 Ollama 跑在 AMD GPU 上）

这个示例是 **“递归自我进化”** 支柱的可运行版本。仅用 PenguinHarness SDK，它会跑完自我进化循环的一轮：

1. **评估（Evaluate）** —— 让 Agent 完成一个约束型写作任务，并按 rubric 打分。
2. **诊断（Diagnose）** —— 从运行结果中看出哪些 rubric 项失了分。
3. **编辑（Edit）** —— 改写 Agent 自己的 `AGENTS.md` 来修复失分点（版本 N+1）。
4. **重新评估（Re-evaluate）** —— 重跑同一任务，只有分数提升时才保留这次改动。

全程跑在一个**本地开源权重模型**上——由 Ollama 提供的 `qwen3:8b`——所以不用任何云端 API、数据也不
离开本机。Ollama 的 ROCm 后端能原生在 AMD GPU 上运行它。

## 为什么用确定性 rubric，为什么要取平均

- **rubric 就是你能读懂的普通代码**（`self-improve.ts` 里的 `score()`）：文件是否确实写出 · 概述
  ≤ 2 句 · 恰好 3 条要点 · 不超过 60 词 · 关键事实是否出现。没有隐藏的裁判——前后分数是客观、可复现的。
  在完整产品里，Evaluator 由 `agent-evaluation` skill 按一份*私有* rubric 驱动；这个示例把那个理念
  蒸馏成可运行的核心。
- 本地模型是**非确定性**的，所以示例对每个版本各跑多次取平均——这正是真实 benchmark 里为每个 Case
  设置 `runs`（多次运行）的原因。单次可能上下波动；均值才能告诉你这次编辑到底有没有帮助。

## 1–2. 提供模型并把 PenguinHarness 指向它

```bash
export HIP_VISIBLE_DEVICES=0        # 可选：指定某张 AMD GPU
ollama serve &
ollama pull qwen3:8b

penguin config model add \
  --model-id qwen3:8b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

## 3. 运行示例

```bash
pnpm install
pnpm build
pnpm --dir examples/self-improving-agent start
# 或直接运行：  npx tsx examples/self-improving-agent/self-improve.ts
```

## 你应当看到什么

```text
BASELINE (blank AGENTS.md): 3 runs
  run 1: 0/5
  run 2: 0/5
  run 3: 0/5
  BASELINE mean: 0.00/5
N+1 (with working discipline): 3 runs
  run 1: 5/5
  run 2: 5/5
  run 3: 5/5
  N+1 mean: 5.00/5
=== Self-improvement result ===
  baseline: 0.00/5   →   N+1: 5.00/5
  Mean score improved — keep version N+1. ✔
```

当 `AGENTS.md` 为空时，`qwen3:8b` 往往会在对话里*叙述*摘要，却从不调用工具把文件写出来——于是
rubric 判它 0 分。加上一小段“任务纪律”（先读原文、把约束逐条列出、真正把文件写出来、结束前自检）就能
扭转这一点。具体数字每次运行会有波动；重点是取平均后的方向。

## 说明

- 使用一个专用 agent id（`self-improve-demo`），运行时即时创建——你自己的 Agent 不会被动到。
- 再次运行会就地更新这个 demo agent。
