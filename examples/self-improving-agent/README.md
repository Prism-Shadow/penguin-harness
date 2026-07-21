<!-- English | [简体中文](README.zh.md) -->

# Example: an Agent that improves itself (local, on an AMD GPU via Ollama)

This example is the **"Recursive Self-Improvement"** pillar in runnable code. Using only the
PenguinHarness SDK, it runs one turn of the self-improvement loop:

1. **Evaluate** a constrained writing task and score it against a rubric.
2. **Diagnose** which rubric points were lost (from the run itself).
3. **Edit** the agent's own `AGENTS.md` to address the failure (version N+1).
4. **Re-evaluate** the same task and keep the change only if the score improved.

Everything runs on a **local open-weight model** — `qwen3:8b` served by Ollama — so no cloud API
and no data leaving the machine. Ollama's ROCm backend runs this natively on AMD GPUs.

## Why a deterministic rubric, and why averaging

- The **rubric is plain code you can read** (`score()` in `self-improve.ts`): file actually
  written · overview ≤ 2 sentences · exactly 3 bullets · under 60 words · key facts present. No
  hidden judge — the before/after numbers are objective and reproducible. In the full product the
  Evaluator is driven by the `agent-evaluation` skill against a *private* rubric; this example
  distills that idea to its runnable core.
- A local model is **nondeterministic**, so the example runs each version several times and
  averages — which is exactly why real benchmarks use a `runs` count per case. A single run can
  swing; the mean is what tells you whether the edit actually helped.

## 1–2. Serve the model and point PenguinHarness at it

```bash
export HIP_VISIBLE_DEVICES=0        # optional: pin a specific AMD GPU
ollama serve &
ollama pull qwen3:8b

penguin config model add \
  --model-id qwen3:8b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

## 3. Run the example

```bash
pnpm install
pnpm build
pnpm --dir examples/self-improving-agent start
# or directly:  npx tsx examples/self-improving-agent/self-improve.ts
```

## What you should see

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

With a blank `AGENTS.md`, `qwen3:8b` tends to *narrate* the summary in chat and never call the
tool to write the file — so the rubric scores it 0. Adding a short "working discipline" section
(read first, restate the constraints, actually write the file, self-check) flips that. Exact
numbers vary run to run; the averaged direction is the point.

## Notes

- Uses a dedicated agent id (`self-improve-demo`), created on the fly — your own agents are
  untouched.
- Re-running updates that demo agent in place.
