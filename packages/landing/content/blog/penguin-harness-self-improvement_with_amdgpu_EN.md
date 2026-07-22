---
title: "Implementing Agent Self-Improvement with PenguinHarness on an AMD GPU"
date: 2026-07-22
category: "news"
excerpt: "A complete PenguinHarness self-improvement loop—from baseline evaluation and Trace analysis to Agent optimization and rollback—using a local Qwen3:8B model alongside the Fireworks API."
description: "Learn how PenguinHarness combines Benchmarks, Traces, editable Agent State, Snapshots, and rollback in a dual-model experiment with local Qwen3:8B and the Fireworks API."
---



# Implementing Agent Self-Improvement with PenguinHarness on an AMD GPU

*AMD × PrismShadow — Yuyang Gao and Ning Zhang (AMD), Yaowei Zheng (PrismShadow).*

[PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) is an open-source Agent Harness that brings model integrations, Agent configuration, workspace tools, Sessions, Traces, Skills, and Benchmarks into one runtime, with both a CLI and a Web UI. It can use hosted models as well as local models exposed through an OpenAI-compatible endpoint.

What makes the project especially interesting is that it represents Agent behavior as a set of readable, editable, and versioned state files rather than as a fixed prompt that only a developer can maintain manually. Role definitions, operating procedures, reusable Skills, and runtime settings all belong to the Agent State, while each task produces a complete Session and Trace. This allows one Agent to evaluate another, update its State using evidence from real executions, and then verify the change against the same evaluation.

This is what PenguinHarness calls “self-improvement.” It does not retrain the model or update its weights. Instead, it improves the Agent Harness around the model and uses repeatable measurements to decide whether a new version should be retained.

## How PenguinHarness Implements Agent Self-Improvement

The main editable parts of an Agent State include:

- `AGENTS.md`: role, boundaries, and operating procedures;
- `skills/`: reusable capabilities;
- `system_config.yaml`: version and runtime configuration.

PenguinHarness organizes the self-improvement process around three roles:

- **Target Agent**: the Agent that performs tasks and is evaluated and improved;
- **Evaluator**: runs one Benchmark Case in an isolated workspace and scores it against a private Rubric;
- **Optimizer**: reads baseline scores and their linked Traces, forms an improvement hypothesis, and modifies the Target Agent State.

The complete loop works as follows:

1. Create a multi-Case Benchmark for the target capability.
2. Run the Target Agent repeatedly to establish a traceable baseline.
3. Use the scores and linked Traces to identify stable failure patterns.
4. Save a Snapshot and modify the Agent State.
5. Evaluate the candidate version with the same Benchmark and the same model.
6. Keep the new version only if its total score is strictly higher; otherwise, restore the previous State.

The loop is orchestrated by built-in Skills:

- `agent-creation`: creates the initial Agent from a set of requirements;
- `benchmark-design`: designs a multi-Case Benchmark and establishes a complete baseline;
- `agent-evaluation`: runs and scores one isolated Case execution;
- `agent-optimization`: analyzes the baseline and Traces, edits Agent State, evaluates the candidate, and handles rollback.

The important point is not simply that “one model rewrites another model’s prompt.” Every change is re-evaluated under the same conditions. The Benchmark provides the measurement, the Trace provides the evidence, the Snapshot provides a recovery point, and the State version ties each score to the Agent State that actually produced it. If an optimization does not yield a strict improvement, the candidate change is not treated as a successful evolution.

To demonstrate the full mechanism, this article uses a dual-model setup. Qwen3:8B runs through Ollama on an AMD GPU and serves as the Target Agent model. A model accessed through the Fireworks API runs `default_agent` and is responsible for creating the Agent, designing the Benchmark, and performing optimization. We first establish a v1 baseline, let the Optimizer improve the Agent using evidence from real Traces, and then use the same Benchmark to decide whether to accept the new version or roll it back. The focus is the self-improvement loop itself, not a model leaderboard comparison.

## What We Will Build

We will create a `meeting-summary-agent`. It reads a small collection of text files and generates the following file in its workspace:

```markdown
# Summary

## Confirmed

## Action Items

## Unresolved
```

The Benchmark contains two Cases:

| Case | Task |
|---|---|
| Single meeting record | Extract the confirmed decision, two action items, and one unresolved item |
| Draft versus formal decision | Read both a draft and a formal decision, and treat the formal decision as authoritative |

Each Case runs independently three times, so one complete evaluation contains six Target Agent runs.

The overall workflow is:

1. Configure local Qwen3:8B and the Fireworks API model.
2. Create the v1 Agent.
3. Export the v1 Snapshot.
4. Create and run the Benchmark.
5. Inspect the baseline and Traces.
6. Optimize the Agent.
7. Evaluate the candidate with the same Benchmark.
8. Accept the new version or roll it back.

---

## Step 1: Configure Qwen3:8B on an AMD GPU and the Fireworks API

This experiment uses two models:

| Purpose | Agent | Model |
|---|---|---|
| Create the Agent, design the Benchmark, and perform optimization | `default_agent` | Fireworks API model |
| Undergo evaluation and improvement | `meeting-summary-agent` | Qwen3:8B on an AMD GPU |

### Prepare Local Qwen3:8B

The local model runs through Ollama. Installing the AMD driver, ROCm, and Ollama is outside the scope of this article; you only need to confirm that Ollama can already run Qwen3:8B successfully. For setup instructions, see the [Ollama Linux documentation](https://docs.ollama.com/linux) and [GPU support documentation](https://docs.ollama.com/gpu).

### Get Fireworks API Access

Through the AMD AI Developer Program, AMD and Fireworks AI offer eligible developers USD 50 in complimentary Fireworks credits. Fireworks provides open-weight models through an OpenAI-compatible endpoint. See [Getting Fireworks API Access](https://penguin.ooo/blog/fireworks-credits-amd) for instructions on redeeming the credits and generating an API key.

### Register the Models in the Web UI

Install and start PenguinHarness:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Open the **Models** page in the Web UI and add the local Qwen3:8B model:

<img width="491" height="481" alt="PenguinHarness local Qwen3:8B model configuration" src="https://github.com/user-attachments/assets/a0d866e9-21e6-4b89-8ec1-b50710aed0db" />


Next, configure the Fireworks API key and set DeepSeek V4 Flash as the default model:

<img width="498" height="479" alt="PenguinHarness Fireworks API model configuration" src="https://github.com/user-attachments/assets/3b392317-615d-46d3-95c9-f9e3b4ad61a5" />


New top-level `default_agent` Chats can now use the Project Default—the Fireworks model. When the Benchmark runs `meeting-summary-agent`, it explicitly selects the following local model pair:

```text
provider: custom
model_id: qwen3:8b
```

The baseline and every candidate must use this same `(provider, model_id)` pair. Otherwise, their scores are not directly comparable.

---

## Step 2: Create the v1 Agent

In the PenguinHarness Web UI, create a new Agent named **meeting-summary-agent**.

Start a new top-level Chat with `default_agent`, select the Fireworks model that was just configured as the Project Default, invoke the `agent-creation` Skill, and submit the prompt below. It creates the v1 version of **meeting-summary-agent**. Version 1 defines only the basic responsibilities and safety boundaries; it does not preload a complete summarization workflow. This allows the Benchmark to expose missing operating habits through actual runs.

<details>
<summary><strong>Expand: Complete Prompt for Creating the v1 Agent</strong></summary>

```text
Use the agent-creation Skill to configure the Agent `meeting-summary-agent`.

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


After the operation completes, the new Agent appears in the Agents list:

<img width="1376" height="464" alt="Meeting Summary Agent in the Agents list" src="https://github.com/user-attachments/assets/7e3f70d2-2164-4f90-8507-6c2d1cd9085c" />


Open the Agent settings and export the v1 Snapshot. This Snapshot provides the recovery point if a later candidate fails:

<img width="790" height="407" alt="Exporting the v1 Agent State Snapshot" src="https://github.com/user-attachments/assets/6f0c4745-3fd5-4c66-b302-bd58e42ce646" />


---

## Step 3: Create the Benchmark

Still in the top-level `default_agent` Chat that uses the Fireworks model, invoke the `benchmark-design` Skill and submit the following prompt to create and calibrate the v1 Benchmark.

Use this Benchmark ID:

```text
simple-file-summary-2case-v1
```

The maximum scores of the two Cases total 100 points, and each Case runs three times. The Target Agent can see only the public Statement, never the private Rubric.

<details>
<summary><strong>Expand: Complete Prompt for Creating and Calibrating the Benchmark</strong></summary>

```text
Use the benchmark-design Skill to create and calibrate a Benchmark for the
following Test Agent.

Test Agent:
meeting-summary-agent

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

After completion, the Benchmark structure looks like this:

<img width="635" height="350" alt="Generated Benchmark structure" src="https://github.com/user-attachments/assets/f44b9bbd-4b38-4c14-aa3a-2d95f44165cf" />


Inspect the output in the Web UI and open the Benchmark page to review the total score, each Case mean, and the corresponding Sessions and Traces:

<img width="550" height="235" alt="Baseline Benchmark score" src="https://github.com/user-attachments/assets/5dbfb515-198d-4d29-9ff3-01eccd61d630" />


The overall baseline score is 84. Because the task is intentionally small, the baseline already exceeds 80, but there is still room for improvement. In the next step, we optimize the Agent to demonstrate the self-improvement process.


---

## Step 4: Optimize the Agent

After the baseline has been established, use the top-level `default_agent` Chat running the Fireworks model to invoke the `agent-optimization` Skill. The prompt instructs the Optimizer to analyze all six runs and their linked Traces, form a generalizable behavioral hypothesis, and then update `AGENTS.md` or create a narrowly scoped Skill.

<details>
<summary><strong>Expand: Complete Prompt for Optimizing the Agent</strong></summary>

```text
Use the agent-optimization Skill in Benchmark optimization mode to improve
the target Agent.

Test Agent:
meeting-summary-agent

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

A likely optimization direction is to add a concise operating procedure or a small set of workflow constraints.

The exact change should be driven by evidence in the real Traces, rather than by embedding the Benchmark answers in the Agent State.

---

## Step 5: Compare Results and Retain the New Version

The Optimizer evaluates the candidate with the same two Cases, the same Qwen3:8B model, and the same three repeated runs.

The acceptance rule is simple:

```text
candidate total > reference total
→ keep the new version

candidate total <= reference total
→ roll back to v1
```

The optimized Agent updates `AGENTS.md`, adds an operating procedure, reruns the Cases, and produces the new score:

<img width="857" height="413" alt="Optimization result and updated Agent State" src="https://github.com/user-attachments/assets/f046ca42-e7ef-4063-8c10-babce816eba4" />


If v2 is accepted, export a v2 Snapshot from the Agent Overview page. To continue improving the Agent, repeat the same process from the accepted version.

Open the Benchmark page and select **MEETING SUMMARY AGENT** to see both evaluation rounds in the improvement history:

<img width="628" height="515" alt="Two rounds in the Benchmark history" src="https://github.com/user-attachments/assets/58be7385-8746-4931-92e6-f563dc26e804" />




> Because this example uses a relatively simple task, a single optimization round can bring the score close to the maximum. On more complex real-world tasks, the value of the self-improvement loop becomes more apparent.

---

## Conclusion

This experiment does not show Qwen3:8B retraining itself during execution. Instead, it shows how PenguinHarness places the Agent’s operating procedure inside a verifiable loop:

```text
Behavior is measured by a Benchmark
→ failures can be traced back through Traces
→ improved procedures are written into Agent State
→ the new version undergoes the complete evaluation again
→ only measured improvements are retained
```

This approach is especially useful for local models. Without preparing training data or fine-tuning model weights, clearer operating procedures can still improve the reliability with which an Agent completes its tasks.

## References

- [PenguinHarness GitHub](https://github.com/Prism-Shadow/penguin-harness)
- [PenguinHarness Self-Improvement Documentation](https://penguin.ooo/docs/self-improvement/)
- [Fireworks API Credits and API Key Guide](https://penguin.ooo/blog/fireworks-credits-amd)
