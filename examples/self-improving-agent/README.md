<!-- English | [简体中文](README.zh.md) -->

# Example: an Agent that improves itself (local, on an AMD GPU via Ollama)

This example is the **"Recursive Self-Improvement"** pillar in runnable code. Using only the
PenguinHarness SDK, the agent runs the self-improvement loop on **itself** — and the key point is
that the improvement is authored by the *agent*, not hardcoded by the script:

1. **Evaluate** — the agent attempts a constrained task and is scored against a rubric (plain code).
2. **Diagnose** — *the agent itself* reads a failing result next to a passing example.
3. **Edit** — *the agent itself* infers the missing rule and writes it into its own `AGENTS.md`.
4. **Re-evaluate** — the same task again; the change is kept only if the mean score improved.

Everything runs on a **local open-weight model** — `qwen3.6:35b` served by Ollama — so no cloud API
and no data leaving the machine. Ollama's ROCm backend runs this natively on AMD GPUs.

## The three scripts (from mechanism to real self-evolution)

| Script | What it demonstrates | `AGENTS.md` edited by |
| --- | --- | --- |
| `self-improve.ts` | The **scoring loop** in miniature (simplest) | the **script** (hardcoded) |
| `self-evolve.ts` | **Genuine** single-round self-evolution | the **agent** itself |
| `self-evolve-recursive.ts` | **Multi-round recursion** — the main line (`pnpm start`) | the **agent**, over two rounds |

`self-improve.ts` is the honest baseline: it shows the evaluate → edit → re-evaluate machinery, but
the edit is a human-written `DISCIPLINE` string the script writes to disk. That demonstrates the
*loop*, not self-evolution. The two `self-evolve*` scripts move the diagnosis **and** the edit into
the agent — the script only supplies a failure signal and one worked example; the model does the
learning and persists it into its own identity file.

## The task, and why the baseline stably fails

The task looks trivial: *summarize `notes.txt` into `summary.md` with a 2-sentence overview and
exactly 3 key facts — and follow your team's standard report format.* The catch is the last clause:
the "team format" is an **arbitrary house convention** (a marker line, a `# Report: <subject>`
title, a `Classification: INTERNAL` line, a `Reviewed-by: Aurora Team` footer) that appears **only
in `AGENTS.md`** and **cannot be inferred from the task**.

This is the design trick that makes the baseline *stably* bad — for any model, strong or weak. The
rubric (`score()`, plain code) has 10 atomic points: **5 content points** any capable model earns
from the task alone, and **5 convention points** that are knowable only from `AGENTS.md`. With a
blank `AGENTS.md` the agent cannot guess the convention, so it stably loses those 5 points. This is
an **information gap, not a capability gap** — the reason a stronger model can't just "figure it
out". It also mirrors the full product, where the Evaluator is driven by the `agent-evaluation`
skill against a *private* rubric.

The agent closes the gap by **learning the convention from a passing example** and writing it into
its own `AGENTS.md` — and in the recursive script, by locking down the fixed constants once it has
seen several examples.

## 1–2. Serve the model and point PenguinHarness at it

```bash
export HIP_VISIBLE_DEVICES=0        # optional: pin a specific AMD GPU
ollama serve &
ollama pull qwen3.6:35b

penguin config model add \
  --model-id qwen3.6:35b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

## 3. Run the example

```bash
pnpm install
pnpm build
pnpm --dir examples/self-improving-agent start        # the recursive main line
# or a single round:  npx tsx examples/self-improving-agent/self-evolve.ts
# or the scoring-loop baseline:  npx tsx examples/self-improving-agent/self-improve.ts
```

## What you should see

```text
N  BASELINE (blank AGENTS.md): 5 runs
  ... scores: [5, 4, 5, 5, 5]  mean: 4.80/10      # loses every convention point

=== REFLECT round 1: infer STRUCTURE from a single accepted report ===
----- after round 1: AGENTS.md the agent authored -----
  ## Report-Publishing Convention ...
  <!-- <UPPERCASE_PROJECT_ID> -->                  # structure learned, constants still guessed
  Reviewed-by: <Team Name>

N+1 (structure learned): 5 runs
  ... scores: [6, 7, 6, 6, 8]  mean: 6.60/10

=== REFLECT round 2: RECURSE on own AGENTS.md — lock CONSTANTS from 3 examples ===
----- after round 2: AGENTS.md the agent authored -----
  ### Fixed Constants (verbatim)
  | 1 | <!-- ACME-DATA-PLATFORM --> |               # constants now locked to literals
  | Last line | Reviewed-by: Aurora Team |

N+2 (constants locked): 5 runs
  ... scores: [10, 10, 9, 10, 10]  mean: 9.80/10

=== Recursive self-evolution trajectory ===
  N (baseline): 4.80/10
  N+1 (structure): 6.60/10   (+1.80)
  N+2 (constants): 9.80/10   (+3.20)
  Monotonic improvement across two self-authored rounds — recursive self-evolution. ✔
```

The trajectory is the point: from one passing example the agent infers the **structure** but can't
tell which tokens are fixed constants vs per-report fields (a single example is ambiguous), so it
stalls mid-way. Given **several** accepted reports that share the same marker and sign-off, it
infers "whatever is identical across all of them is a fixed constant", reads its **own** round-1
`AGENTS.md`, and refines it — recursion in the true sense: `state_{n+1} = agent.reflect(state_n,
new_evidence)`. Exact numbers vary run to run; the monotonic direction is the point.

## Honest boundaries

- **Self-evolution needs a capable model.** Authoring a correct rule and then *following it* is
  harder than benefiting from a hardcoded one. A weaker model (e.g. `qwen3:8b`) often infers the
  rule but executes it unreliably (placeholders left unfilled, or narrating instead of writing the
  file), so its N+1 can *regress* and the script rolls back. That rollback is the loop being honest,
  not a bug.
- **Evidence sufficiency is real.** N+1 stalls at a middling score because one example genuinely
  under-determines the fixed constants; N+2 only climbs because more examples make them inferable.
  The gain is information-driven learning, not noise.

## Notes

- Uses a dedicated agent id (`self-improve-demo`), created on the fly — your own agents are
  untouched.
- The script never writes the convention itself; it only supplies the failing report, the accepted
  example(s), and the keep/roll-back signal.
- Re-running resets the demo agent's `AGENTS.md` to blank and starts the loop over.
