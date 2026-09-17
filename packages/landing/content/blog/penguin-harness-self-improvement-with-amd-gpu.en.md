---
title: "Run an agent self-improvement loop with PenguinHarness on an AMD GPU"
date: 2026-07-22
category: practice
author: Yuyang Gao (AMD), Ning Zhang (AMD), Yaowei Zheng (PrismShadow)
excerpt: "Run a complete PenguinHarness self-improvement loop, from baseline evaluation and Trace analysis to agent optimization and rollback, with a local Qwen3:8B model on an AMD GPU and a model on the Fireworks API."
description: "Learn how PenguinHarness combines Benchmarks, Traces, editable Agent State, Snapshots, and rollback in a dual-model experiment with local Qwen3:8B and the Fireworks API."
---

> Written for PenguinHarness 0.1.1. Later releases may differ in some details.

*AMD × PrismShadow — Yuyang Gao and Ning Zhang (AMD), Yaowei Zheng (PrismShadow).*

In this tutorial you run a complete self-improvement loop with [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness). You create a small agent, measure it with a Benchmark, let an Optimizer improve it using evidence from real Traces, and keep the new version only if it scores higher. The agent under test runs on Qwen3:8B on an AMD GPU; the agent that creates, measures and optimizes it runs on a model from the Fireworks API.

The model is never retrained, and no weights change. The tutorial is for developers who want to make an agent more reliable without preparing training data, especially when the agent runs a local model. The task is intentionally small, because the subject is the loop itself, not a comparison of models on a leaderboard.

## Prerequisites

- An AMD GPU on which Ollama can already run Qwen3:8B. Installing the AMD driver, ROCm and Ollama is outside the scope of this tutorial; for setup instructions, see the [Ollama Linux documentation](https://docs.ollama.com/linux) and the [GPU support documentation](https://docs.ollama.com/gpu).
- Fireworks API access. Through the AMD AI Developer Program, AMD and Fireworks AI offer eligible developers USD 50 in complimentary Fireworks credits, and Fireworks provides open-weight models through an OpenAI-compatible endpoint. [Getting Fireworks API Access](https://penguin.ooo/blog/fireworks-credits-amd) explains how to redeem the credits and generate an API key.

## How self-improvement works in PenguinHarness

PenguinHarness is an open-source agent harness. It brings model integrations, agent configuration, Workspace tools, Sessions, Traces, Skills and Benchmarks into one runtime, with both a CLI and a Web App, and it can use hosted models as well as local models exposed through an OpenAI-compatible endpoint.

PenguinHarness represents an agent's behavior as a set of readable, editable and versioned state files, rather than as a fixed prompt that only a developer can maintain by hand. Role definitions, operating procedures, reusable Skills and runtime settings all belong to the Agent State, and each task produces a complete Session and Trace. So one agent can evaluate another, update its State using evidence from real executions, and then verify the change against the same evaluation.

That is what PenguinHarness calls self-improvement. It does not retrain the model or update its weights. It improves the agent harness around the model, and uses repeatable measurements to decide whether a new version is kept.

### The editable Agent State

The main editable parts of an Agent State are:

- `AGENTS.md`: role, boundaries and operating procedures;
- `skills/`: reusable capabilities;
- `system_config.yaml`: version and runtime configuration.

### Three roles

- **Target Agent**: the agent that performs tasks, and is evaluated and improved;
- **Evaluator**: runs one Benchmark Case in an isolated Workspace and scores it against a private Rubric;
- **Optimizer**: reads baseline scores and their linked Traces, forms an improvement hypothesis, and modifies the Target Agent State.

### The loop

1. Create a multi-Case Benchmark for the target capability.
2. Run the Target Agent repeatedly to establish a traceable baseline.
3. Use the scores and linked Traces to identify stable failure patterns.
4. Save a Snapshot and modify the Agent State.
5. Evaluate the candidate version with the same Benchmark and the same model.
6. Keep the new version only if its total score is strictly higher; otherwise, restore the previous State.

Built-in Skills orchestrate the loop:

- `agent-creation`: creates the initial agent from a set of requirements;
- `benchmark-design`: designs a multi-Case Benchmark and establishes a complete baseline;
- `agent-evaluation`: runs and scores one isolated Case execution;
- `agent-optimization`: analyzes the baseline and Traces, edits the Agent State, evaluates the candidate and handles rollback.

The point is not simply that one model rewrites another model's prompt. Every change is re-evaluated under the same conditions. The Benchmark provides the measurement, the Trace provides the evidence, the Snapshot provides a recovery point, and the State version ties each score to the Agent State that actually produced it. If an optimization does not yield a strict improvement, the candidate change does not count as a successful evolution.

### Two models, two jobs

This tutorial splits the work between two models:

| Purpose | Agent | Model |
|---|---|---|
| Create the agent, design the Benchmark, and perform optimization | `default_agent` | Fireworks API model |
| Undergo evaluation and improvement | `meeting_summary_agent` | Qwen3:8B on an AMD GPU |

Qwen3:8B runs through Ollama on the AMD GPU and serves as the Target Agent model. A model on the Fireworks API runs `default_agent`, which creates the agent, designs the Benchmark and performs the optimization. You first establish a v1 baseline, let the Optimizer improve the agent using evidence from real Traces, and then use the same Benchmark to decide whether to accept the new version or roll it back.

## What you will build

You create `meeting_summary_agent`. It reads a small collection of text files and writes the following file in its Workspace:

```markdown
# Summary

## Confirmed

## Action Items

## Unresolved
```

You measure it with a Benchmark of two Cases:

| Case | Task |
|---|---|
| Single meeting record | Extract the confirmed decision, two action items, and one unresolved item |
| Draft versus formal decision | Read both a draft and a formal decision, and treat the formal decision as authoritative |

Each Case runs independently three times, so one complete evaluation contains six Target Agent runs.

The steps below follow this workflow:

1. Configure local Qwen3:8B and the Fireworks API model.
2. Create the v1 agent.
3. Export the v1 Snapshot.
4. Create and run the Benchmark.
5. Inspect the baseline and Traces.
6. Optimize the agent.
7. Evaluate the candidate with the same Benchmark.
8. Accept the new version or roll it back.

## Step 1: Install PenguinHarness and register the models

In this step you install PenguinHarness and register both models the experiment uses.

Install and start PenguinHarness:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Open the **Models** page in the Web App and add the local Qwen3:8B model:

<img width="491" height="481" alt="PenguinHarness local Qwen3:8B model configuration" src="https://github.com/user-attachments/assets/a0d866e9-21e6-4b89-8ec1-b50710aed0db" />

Next, configure the Fireworks API key and set DeepSeek V4 Flash as the default model:

<img width="498" height="479" alt="PenguinHarness Fireworks API model configuration" src="https://github.com/user-attachments/assets/3b392317-615d-46d3-95c9-f9e3b4ad61a5" />

New top-level `default_agent` chats now use the Project default, which is the Fireworks model. When the Benchmark runs `meeting_summary_agent`, it explicitly selects this local model pair:

```text
provider: custom
model_id: qwen3:8b
```

The baseline and every candidate must use this same `(provider, model_id)` pair. Otherwise, their scores are not directly comparable.

## Step 2: Create the v1 agent

In this step you create the first version of the Target Agent and save a Snapshot of it as a recovery point.

1. In the Web App, create a new agent with the id `meeting_summary_agent`. An agent id takes only lowercase letters, digits and underscores, so a hyphenated id is rejected.
2. Start a new top-level chat with `default_agent`, and select the Fireworks model you just set as the Project default.
3. Invoke the `agent-creation` Skill (renamed `agent-initialization` in PenguinHarness 0.2.4) and submit the prompt below.

The prompt creates v1 of `meeting_summary_agent`. Version 1 defines only the basic responsibilities and safety boundaries. It does not preload a complete summarization workflow, so the Benchmark can expose the operating habits the agent lacks through actual runs.

<details>
<summary><strong>Expand: complete prompt for creating the v1 agent</strong></summary>

```text
Use the agent-creation Skill to configure the Agent `meeting_summary_agent`.

Goal:
This is a simple local-file summarization Agent. It reads the task instructions
and text files in the current workspace, then creates the summary file requested
by the task.

Keep v1 minimal:

1. In AGENTS.md, specify only that the Agent should:
   - Read the task and relevant files in the current workspace.
   - Produce a concise summary based on the file contents.
   - Work only inside the current workspace.
   - Not access external services.
   - Not expose environment variables, credentials, or unrelated files.

2. Do not preload a complete file-summarization workflow, such as:
   - Requiring an inventory and full read of every source file.
   - Systematically distinguishing drafts from formal decisions.
   - Requiring all information to be divided into Confirmed, Action Items,
     and Unresolved sections.
   - Requiring a line-by-line validation of the output after creation.

3. Do not install a domain-specific Skill.
4. Do not deliberately instruct the Agent to make mistakes.
5. Do not modify the stable system_prompt.
6. Set:
   - name: Meeting Summary Agent
   - description: Summarizes a small set of local text files.

Finally, report the Agent State files that were changed and the current
State version.
```

</details>

When the operation completes, the new agent appears in the Agents list. The screenshot comes from the original run, in which the agent's id was `meeting-summary-agent`:

<img width="1376" height="464" alt="Meeting Summary Agent in the Agents list" src="https://github.com/user-attachments/assets/7e3f70d2-2164-4f90-8507-6c2d1cd9085c" />

Open the agent's settings and, on the **Overview** tab, click **Export snapshot** to export the v1 Snapshot. The Snapshot is the recovery point if a later candidate fails, and the `agent-optimization` Skill will not change the Agent State until it exists:

<img width="790" height="407" alt="Exporting the v1 Agent State Snapshot" src="https://github.com/user-attachments/assets/6f0c4745-3fd5-4c66-b302-bd58e42ce646" />

## Step 3: Create the Benchmark and measure the baseline

In this step you create and calibrate the Benchmark, and run the complete baseline for v1.

In the same top-level `default_agent` chat on the Fireworks model, invoke the `benchmark-design` Skill and submit the prompt below. It creates and calibrates the v1 Benchmark, with this Benchmark ID:

```text
simple-file-summary-2case-v1
```

The maximum scores of the two Cases total 100 points, and each Case runs three times. The Target Agent sees only the public Statement, never the private Rubric.

<details>
<summary><strong>Expand: complete prompt for creating and calibrating the Benchmark</strong></summary>

```text
Use the benchmark-design Skill to create and calibrate a Benchmark for the
following Test Agent.

Test Agent:
meeting_summary_agent

Benchmark ID:
simple-file-summary-2case-v1

Evaluation model:
provider: custom
model_id: qwen3:8b

Target capability:
Read a small set of local text files and create SUMMARY.md in the workspace root.
Accurately distinguish confirmed facts, action items, and unresolved information.
When a draft conflicts with an explicit formal decision, treat the formal decision
as authoritative.
Do not guess or modify the input materials.

Shared requirements:
1. Each Case Statement must provide README.md and materials/*.txt.
2. The Target Agent must create SUMMARY.md.
3. SUMMARY.md must contain:
   - # Summary
   - ## Confirmed
   - ## Action Items
   - ## Unresolved
4. Do not modify README.md or materials/.
5. Set runs = 3.
6. The maximum scores of the two Rubrics must total 100 points.
7. The Statement must not reveal the private Rubric or expected answer.

Create the following two Cases.

CASE-001: Single meeting record, maximum 45 points

materials/meeting.txt:

Product weekly meeting, dated 2026-08-03.

Formal decision: open the internal trial on 2026-08-10.

Xiaolin is responsible for preparing the user guide, due 2026-08-06.
Xiaozhou is responsible for completing smoke testing, due 2026-08-08.

Whether mobile export will be included in this trial remains undecided.

The Rubric should check:
- Whether SUMMARY.md exists.
- Whether the title and categories are correct.
- Whether the internal trial date is accurate.
- Whether the owner, task, and deadline are complete for both action items.
- Whether mobile export remains classified as unresolved.
- Whether no information was invented.
- Whether the input files remain unchanged.

CASE-002: Draft versus formal decision, maximum 55 points

materials/plan_draft.txt:

Project draft, dated 2026-08-01.
The draft proposes a launch date of 2026-08-15.
The tentative owner is Xiaolin.

materials/final_decision.txt:

Formal decision, dated 2026-08-04.
Because testing has been delayed, the launch date is changed to 2026-08-22.
Xiaolin is responsible for release preparation, due 2026-08-20.
The email campaign date remains undecided.

The Rubric should check:
- Whether SUMMARY.md exists.
- Whether the title and categories are correct.
- Whether the formal launch date, 2026-08-22, is used.
- Whether the draft date is not presented as the current decision.
- Whether the release-preparation task and deadline are extracted accurately.
- Whether the email campaign date remains classified as unresolved.
- Whether no information was invented.
- Whether the input files remain unchanged.

Complete the full 2 Cases × 3 runs baseline and write the result to
scoreboard.yaml.

Finally, report:
- The Benchmark path.
- The total score.
- The three raw scores and mean for each Case.
- Run-to-run variation.
- All Test Session IDs.
```

</details>

When it completes, the Benchmark has this structure:

<img width="635" height="350" alt="Generated Benchmark structure" src="https://github.com/user-attachments/assets/f44b9bbd-4b38-4c14-aa3a-2d95f44165cf" />

Check the run's output in the Web App, then open **Evaluation Center** to review the total score, the mean of each Case, and the Sessions and Traces behind them:

<img width="550" height="235" alt="Baseline Benchmark score" src="https://github.com/user-attachments/assets/5dbfb515-198d-4d29-9ff3-01eccd61d630" />

The baseline total is 84. The task is intentionally small, so the baseline already exceeds 80, but there is still room for improvement. This score is the reference the candidate must beat.

## Step 4: Optimize the agent

In this step the Optimizer analyzes all six runs and their linked Traces, then makes one small, evidence-based change to the Agent State.

In the top-level `default_agent` chat on the Fireworks model, invoke the `agent-optimization` Skill and submit the prompt below. It instructs the Optimizer to form one generalizable behavioral hypothesis, and then to update `AGENTS.md` or create a narrowly scoped Skill.

<details>
<summary><strong>Expand: complete prompt for optimizing the agent</strong></summary>

```text
Use the agent-optimization Skill in Benchmark optimization mode to improve
the target Agent.

Test Agent:
meeting_summary_agent

Benchmark:
simple-file-summary-2case-v1

Optimization objective:
Improve the reliability of reading a small set of local files and producing
an accurate summary.

Rules:
1. Use the complete baseline for the current version in scoreboard.yaml as
   the reference.
2. Keep the same model:
   - provider: custom
   - model_id: qwen3:8b
3. Do not modify the Cases, Statements, Rubrics, or runs.
4. Analyze both Cases, all three runs per Case, and every score-linked Trace.
5. In this round, propose only one falsifiable behavioral hypothesis that
   generalizes across Cases.
6. Make only the smallest Agent State change needed to support that hypothesis.
7. Prefer editing AGENTS.md. Create a narrowly scoped Skill only if a genuinely
   reusable capability is needed.
8. Do not encode Case IDs, names, specific dates, expected answers, or private
   Rubric content.
9. The candidate must run the complete 2 Cases × 3 runs matrix.
10. Accept the candidate only if its total score is strictly higher than the
    reference. Roll it back if the score is equal or lower.
11. Accept at most one new version in this run.

Finally, report:
- The reference total and Case means.
- Stable failure patterns found in the Traces.
- The behavioral hypothesis.
- The Agent State files that were changed.
- The candidate total and Case means.
- The reason for acceptance or rollback.
- All Test Session IDs.
```

</details>

A likely direction is a concise operating procedure or a small set of workflow constraints. The exact change should come from evidence in the real Traces, not from embedding the Benchmark answers in the Agent State.

## Step 5: Compare the results and keep the new version

In this step the Optimizer evaluates the candidate under identical conditions and applies the acceptance rule.

The candidate runs with the same two Cases, the same Qwen3:8B model and the same three repeated runs. The acceptance rule is simple:

```text
candidate total > reference total
→ keep the new version

candidate total <= reference total
→ roll back to v1
```

In this run, the Optimizer adds an operating procedure to `AGENTS.md`, reruns the Cases and reports the new score:

<img width="857" height="413" alt="Optimization result and updated Agent State" src="https://github.com/user-attachments/assets/f046ca42-e7ef-4063-8c10-babce816eba4" />

If v2 is accepted, export a v2 Snapshot from the agent's **Overview** tab. To keep improving the agent, repeat the same process from the accepted version.

Open **Evaluation Center** and select **MEETING SUMMARY AGENT** to see both evaluation rounds in the improvement history:

<img width="628" height="515" alt="Two rounds in the Benchmark history" src="https://github.com/user-attachments/assets/58be7385-8746-4931-92e6-f563dc26e804" />

Because the task is relatively simple, a single optimization round brings the score close to the maximum. On more complex real-world tasks, the value of the self-improvement loop becomes more apparent.

## What the experiment shows

You measured a baseline of 84, let the Optimizer change the Agent State based on Trace evidence, and applied a rule that keeps a new version only when it scores strictly higher under the same Benchmark, model and run count.

This experiment does not show Qwen3:8B retraining itself during execution. It shows how PenguinHarness places the agent's operating procedure inside a verifiable loop:

```text
Behavior is measured by a Benchmark
→ failures can be traced back through Traces
→ improved procedures are written into Agent State
→ the new version undergoes the complete evaluation again
→ only measured improvements are retained
```

This approach is especially useful for local models. Without preparing training data or fine-tuning model weights, clearer operating procedures can still make an agent complete its tasks more reliably.

## References

- [PenguinHarness GitHub](https://github.com/Prism-Shadow/penguin-harness)
- [PenguinHarness Self-Improvement Documentation](https://penguin.ooo/docs/self-improvement/)
- [Fireworks API Credits and API Key Guide](https://penguin.ooo/blog/fireworks-credits-amd)
