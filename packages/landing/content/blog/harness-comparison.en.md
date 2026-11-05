---
title: "Organizing Cross-Harness Comparison Experiments with PenguinHarness"
date: 2026-11-05
category: practice
excerpt: "With the base model and thinking effort fixed, we compare four harnesses—PenguinHarness, DSH, Pi, and Codex—across five benchmarks totaling 50 tasks over three full repetitions, examining pass rates, multi-run stability, and resource costs, and showing how to organize and reproduce the evaluation in PenguinHarness."
---

Putting the exact same model into different harnesses often produces noticeably different task execution results. Before optimizing a harness or introducing RSI algorithms to improve an agent, we first need a fixed baseline: when the underlying model is held strictly constant, how much do task pass rates, multi-run stability, and resource consumption vary across harnesses?

This post presents the three-run comparison results of four harnesses—PenguinHarness, DSH, Pi, and Codex—across five benchmarks totaling 50 tasks, and explains the model configuration, launch workflows, and how to organize and reproduce the entire evaluation using PenguinHarness.

## 1. Experiment Design and Benchmark Tasks

All four experimental groups connect to the same model, `DeepSeek-V4.1-Flash-1017`, with thinking effort fixed to `max`. The evaluated versions are locked to PenguinHarness 0.2.17, DSH 0.2.1-rc.2, Pi 1.4.0, and Codex 0.162.1. Each harness runs all 50 tasks for 3 full repetitions inside isolated Docker containers via Harbor 0.23.0, totaling 600 trials:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/03-experiment-design.png" width="2880" height="1730" alt="Figure 1 | Experiment Design: Four harnesses at locked versions run three full repetitions of 50 fixed tasks across subsets A–E under identical model settings, totaling 600 trials." /><figcaption>Figure 1 | Experiment Design: Four harnesses at locked versions run three full repetitions of 50 fixed tasks across subsets A–E under identical model settings, totaling 600 trials.</figcaption></figure>

These 50 tasks were selected from 864 candidate tasks across five public benchmarks through two rounds of empirical filtering; the full selection process is documented in [SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md). The first round removed tasks requiring GPUs, multi-container orchestration, more than 8 GB of RAM, or large runtime weight downloads, ensuring that the entire suite runs on a single CPU-only machine with an API cost under $20 per 50-task repetition. The second round calibrated the difficulty gradient from trial score distributions, fixing five benchmarks from A to E with 10 tasks each:

| Subset | Benchmark ID | Upstream Source | Evaluation Scope | Timeout | Turn Limit |
| --- | --- | --- | --- | --- | --- |
| Sec A | penguinharness-benchmark-sec-a | Data Analysis Bench | Clean, compute, and summarize across multi-source documents, spreadsheets, and databases | 15m | 100 |
| Sec B | penguinharness-benchmark-sec-b | DeepSWE v1.1 | Locate bugs, write patches, and pass regression tests in real open-source repositories | 30m | 250 |
| Sec C | penguinharness-benchmark-sec-c | AutomationBench | Call business and local service APIs to complete multi-step automation workflows | 10m | 50 |
| Sec D | penguinharness-benchmark-sec-d | Terminal-Bench-Science 0.1 | Perform scientific computing and modeling in Linux terminals across astrophysics and bioinformatics | 40m | 320 |
| Sec E | penguinharness-benchmark-sec-e | Terminal-Bench 4.0 | Complete system troubleshooting, storage-engine repair, and build debugging in real terminals | 25m | 200 |

## 2. Model Configuration and Launch Workflows

Organizing and reproducing this evaluation in PenguinHarness starts with configuring the model and thinking effort, followed by choosing the launch path that matches the target under test. As shown in Figure 2, evaluating an internal PenguinHarness agent uses the Evaluation Center and the built-in `agent-evaluation` skill, whereas evaluating external harnesses such as DSH, Pi, and Codex uses a workspace conversation where the organizing agent invokes custom batch scripts. Both paths share the underlying Harbor container scheduler and independent verifier grading.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/04-penguin-reproduction-flow.png" width="2880" height="2080" alt="Figure 2 | Reproduction Architecture: Initiated at the top by an organizing agent in PenguinHarness; internal agents follow the left Evaluation Center and agent-evaluation skill path, while DSH, Pi, and Codex follow the right custom batch path; both share Harbor container scheduling, adapter loading, independent verifier grading, and result archiving." /><figcaption>Figure 2 | Reproduction Architecture: Initiated at the top by an organizing agent in PenguinHarness; internal agents follow the left Evaluation Center and agent-evaluation skill path, while DSH, Pi, and Codex follow the right custom batch path; both share Harbor container scheduling, adapter loading, independent verifier grading, and result archiving.</figcaption></figure>

**Step 1: Configure the Model and Thinking Effort**

In the Model settings of the PenguinHarness Web UI, select the `deepseek` provider, add `DeepSeek-V4.1-Flash-1017`, and save the API key; alternatively, register and set it as the default model from the terminal via the CLI:

```bash
penguin config model add \
  --provider deepseek \
  --model-id DeepSeek-V4.1-Flash-1017 \
  --api-key <YOUR_API_KEY> \
  --set-default
```

Note that **thinking effort is configured separately for the organizing session and the agent under test**: switching thinking effort to `Max` below the chat input only affects the current organizing session; when evaluating an internal agent via the `agent-evaluation` skill, the tested agent's `thinking_level` is read from its own `system_config.yaml`, so set its thinking effort to `max` in the agent settings before starting. When testing external harnesses via batch scripts, pass `thinking=max` explicitly in the launch arguments.

**Step 2: Evaluate an Internal PenguinHarness Agent via the Evaluation Center and `agent-evaluation` Skill**

Every new PenguinHarness Project includes the five built-in benchmarks Sec A through Sec E, and the default agent `default_agent` comes pre-installed with the `agent-evaluation` skill from the `Default RSI Toolkit` plugin. Following the left branch of Figure 2, launching an evaluation takes three steps:

- **Select parameters in the Evaluation Center**: Open the Evaluation Center in the left sidebar, click **Use** in the top-right corner of the target benchmark, and set four parameters on the **Evaluate** tab—select `default_agent` as the Test Agent, select `default_agent` with the `agent-evaluation` skill as the Evaluator Agent, choose `deepseek/DeepSeek-V4.1-Flash-1017` as the evaluation session model, and set `runs` to `3`.
- **Preselect the skill and send the prompt**: Clicking confirm opens a new conversation with the `agent-evaluation` skill preselected and the evaluation prompt filled in; you can also open a new conversation manually, select the `agent-evaluation` skill, and send:

```markdown
[use_skills]
- agent-evaluation
[/use_skills]
Please use the `agent-evaluation` Skill to evaluate the target agent on this frozen Benchmark.

- test_agent_id: `default_agent`
- benchmark_id: `penguinharness-benchmark-sec-e`
- runs: `3`
```

- **Dispatch evaluation workers from the main session**: Upon receiving the prompt, the main session checks out the repository snapshot, creates the shared Docker network, and builds the offline runtime bundle according to the `agent-evaluation` skill specification. It then schedules `10 tasks × 3 runs = 30` evaluation units, dispatching background subagent workers via `run_subagent` with a default concurrency limit of 4. Each worker receives **a single internal `test_agent_id`, one task, and one run index**, packages the tested agent's `agent_state`, and calls `harbor run` inside an isolated Docker container to complete execution and grading; once all 30 units return, the main session aggregates the mean score and writes it to `scoreboard.yaml`.

**Step 3: Evaluate DSH, Pi, and Codex via Custom Batch Scripts in a Workspace Conversation**

Because the `agent-evaluation` skill targets an internal PenguinHarness `test_agent_id`, it does not drive external CLI harnesses directly from a single skill prompt. Evaluating DSH, Pi, and Codex connects through their respective Harbor adapters and job configurations, following the right branch of Figure 2:

> **Start batch script from a PenguinHarness workspace conversation → `harbor run -c <job_config> -y` → Load the target adapter inside the container to run the harness → Grade via independent verifier → Archive per-task records and summary statistics**

Open a regular conversation bound to the benchmark repository workspace in PenguinHarness without selecting the `agent-evaluation` skill, and let the organizing agent run the batch script or invoke Harbor per subset:

```bash
export PYTHONPATH="$PWD/agents"
uvx --from harbor==0.23.0 harbor run \
  -c benchmarks/terminal-bench/job.yaml \
  -a <harness_adapter_module>:<AdapterClass> \
  -m deepseek/DeepSeek-V4.1-Flash-1017 \
  --ak thinking=max \
  --ak run_timeout=25m --ak max_turns=200 \
  --job-name terminal-bench-attempt-1 -y
```

Here `-a` specifies the harness adapter, such as `penguin_agent:PenguinAgent` or the respective adapters for DSH, Pi, and Codex. The script runs all five subsets sequentially across repetitions 1 to 3, generating standardized `meta_info.yaml`, `test/attempt-1..3.yaml`, and `test/summary.yaml` files after each repetition.

## 3. Shared Execution and Grading Rules Across All Four Groups

Whether dispatched through `agent-evaluation` workers or invoked via Harbor batch scripts, all four harnesses follow the exact same rules for environment preparation, network isolation, in-container execution, and unstarted-trial reruns. Inside each isolated task container, PenguinHarness, DSH, Pi, and Codex operate on completely equal footing under Harbor scheduling and independent verifier grading.

**Stage 1: Offline Runtime Bundles and Isolated Credentials**

Before execution begins, the 40-character repository commit snapshot for the 50 tasks, the harness version numbers, and the per-subset runtime limits are locked. To avoid downloading runtimes repeatedly from the public internet on every container start or polluting the task container's native Python and Node toolchains, the host pre-packages each harness runtime into an offline bundle that is mounted and extracted into an isolated directory when the container starts. Meanwhile, the adapter extracts only the single API key for the model under test from the host configuration, writes it to a temporary private path outside the container log directory, and erases it immediately after the task finishes so credentials never leak into command-line arguments or archived logs.

**Stage 2: Single-Task Smoke Check and Batch Concurrency Control**

Before launching three full repetitions, a single task is run at concurrency 1 to verify that bundle extraction, model requests, artifact persistence, and verifier grading work end to end before scaling up across the five subsets. Two environment controls govern batch execution:

- **Subset network isolation**: Subsets A, C, D, and E allow public internet access and reuse the shared `penguin-bench` bridge network, whereas Subset B—which evaluates bug fixing in open-source repositories—disables public internet access entirely and whitelists only the model API host via `--allow-agent-host`, preventing agents from searching online for existing fix PRs or issues.
- **Concurrency and Docker address-pool management**: Harbor creates a dedicated network per task container by default, while a standard Docker daemon provides only 31 subnet pools. Reproducing via the `agent-evaluation` skill runs at a default concurrency of 4 subagent sessions; on batch servers preconfigured with a shared bridge network or expanded subnet pools, historical runs used up to 10 concurrent containers to reduce wall-clock time.

**Stage 3: In-Container Trial Execution and Decoupled Grading**

Each single-task attempt is one Trial, executed inside an isolated container across the three phases shown in Figure 3: Task Input, Harness Execution, and Trial Completion. The harness reads the task instructions and initial files, alternates between model inference and tool execution, and writes modified code or data to the working directory until it exits voluntarily or reaches the timeout or request limit. The critical architectural choice here is **strictly decoupling execution telemetry from verifier grading**: once the agent stops, the runner and adapter record the exit status, duration, three token categories, and API cost, while the independent verifier inspects only the working-directory artifacts to assign a score of 100 or 0 before both records are merged into the per-task archive.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/05-trial-execution.png" width="2880" height="1750" alt="Figure 3 | Single-Task Execution and Grading: The harness loops between model inference and tool execution, writing artifacts to the working directory; after completion, the independent verifier inspects the working directory to assign 100 or 0, while the runner and adapter record exit status, duration, token usage, and API cost before merging both into the archive." /><figcaption>Figure 3 | Single-Task Execution and Grading: The harness loops between model inference and tool execution, writing artifacts to the working directory; after completion, the independent verifier inspects the working directory to assign 100 or 0, while the runner and adapter record exit status, duration, token usage, and API cost before merging both into the archive.</figcaption></figure>

Take Task 8 in Subset E, `embedding-drift-monitor`, as a concrete example: the container mounts monitoring code and test data containing false-positive, false-negative, and alert-flapping bugs; the harness reads the instructions, inspects the data distribution in the terminal, and edits the statistical test and debouncing logic until it exits voluntarily or hits the subset limit of 25 minutes or 200 model turns.

The independent verifier then runs the acceptance test suite. On this task, Codex exited normally within 8–9 minutes across all three repetitions, but its modified code failed the acceptance tests and scored 0 all three times; conversely, both PenguinHarness and DSH produced code that passed verification and scored 100 across all three repetitions—even if an agent fixes the code just before timeout and is subsequently terminated by the time limit, it still receives the full 100 points as long as the artifacts left in the working directory pass verification.

**Stage 4: Screening Unstarted Exceptions and Archiving**

After each repetition completes, integrity is checked according to `tools/measure/reruns.py`, strictly separating "environment failed to start" from "agent failed the task": a trial is classified as unstarted and rerun at lower concurrency only if service startup or configuration errors leave `agent_execution.started_at` missing or model requests at zero, or if `exception_info` explicitly records Docker subnet pool exhaustion. Once an agent has sent its first model request and begun working, its original result is preserved regardless of mid-run tool errors or timeouts; if the verifier itself crashes without producing a score, the trial is flagged separately as an invalid run rather than recorded as zero.

## 4. Scoring and Statistical Methodology

Once all 600 trials are archived, scores and resource usage are aggregated under a unified specification; see the [Evaluation Data and Submission Workflow Specification](https://club.penguin.ooo/zh/workflow/evaluation/) for full details.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/06-statistics-method.png" width="2880" height="2392" alt="Figure 4 | Statistical Methodology: Using DSH as an example, Step 01 averages the 10 tasks within each subset per repetition; Step 02 takes the equal-weight average across subsets A–E within the same repetition to obtain overall scores of 40, 38, and 38; Step 03 computes the cross-repetition mean of 38.67 and sample standard deviation of 1.15 with denominator 3 - 1 = 2." /><figcaption>Figure 4 | Statistical Methodology: Using DSH as an example, Step 01 averages the 10 tasks within each subset per repetition; Step 02 takes the equal-weight average across subsets A–E within the same repetition to obtain overall scores of 40, 38, and 38; Step 03 computes the cross-repetition mean of 38.67 and sample standard deviation of 1.15 with denominator 3 - 1 = 2.</figcaption></figure>

**Scores and Sample Standard Deviation**

Passing a task scores 100 points and failing scores 0. Each harness completes 150 task attempts across the three repetitions, so each additional passed attempt raises the overall mean by 0.67 points. As shown in Figure 4, scores are aggregated in three steps using sample standard deviation with denominator `3 - 1 = 2`:

- **01 Single-repetition subset score**: Average the 10 tasks within a subset for a given repetition. To inspect a single subset across repetitions, compute the mean and sample standard deviation over its three repetition scores—for example, DSH scores 10, 20, and 30 on Sec E, reported as 20.00 ± 10.00.
- **02 Single-repetition overall score**: Within the same repetition, take the equal-weight average of the five subset scores A through E to obtain the 50-task overall score for that repetition. For instance, PenguinHarness scores 36, 40, and 38 across the three repetitions, while DSH scores 40, 38, and 38.
- **03 Cross-repetition mean and sample standard deviation**: Compute the final mean and sample standard deviation across the three repetition overall scores—for example, 38.00 ± 2.00 for PenguinHarness and 38.67 ± 1.15 for DSH.

Computing each repetition's overall score before taking the standard deviation across repetitions prevents mixing intrinsic difficulty differences across task categories into the variance, and captures how fluctuations across subsets within the same repetition offset one another.

**Single-Repetition Resource Overhead**

Summing the three-repetition average overhead across subsets A through E measures the average resource investment required to complete one full 50-task repetition:

- **API cost**: The sum of single-repetition average costs across the five subsets priced against a unified catalog; because archived subset costs are rounded, totals are reported as approximate values.
- **Cumulative agent runtime**: The direct sum of in-container execution times across all 50 tasks, reflecting total compute time rather than parallel wall-clock wait time; at concurrency 4, wall-clock duration is roughly one-quarter of cumulative runtime.
- **Three token categories**: During multi-turn tool use, terminal outputs and message history are resent as input in subsequent turns, so raw input totals include cache reads. To avoid double counting, tokens are broken down following Figure 10 into **uncached input**, **cache read**, and **output**; output tokens count only model-generated reasoning, replies, and tool call arguments, excluding tool return payloads.

## 5. Empirical Results and Key Insights

The three-repetition overall scores of the four harnesses across the five benchmarks totaling 50 tasks are:

- **PenguinHarness**: 38.00 ± 2.00, repetition scores 36 / 40 / 38, passing 57 of 150 attempts
- **DSH**: 38.67 ± 1.15, repetition scores 40 / 38 / 38, passing 58 of 150 attempts
- **Pi**: 34.00 ± 3.46, repetition scores 32 / 38 / 32, passing 51 of 150 attempts
- **Codex**: 30.00 ± 2.00, repetition scores 32 / 28 / 30, passing 45 of 150 attempts

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/01-overall-bars.png" width="2880" height="1140" alt="Figure 5 | Overall Score Comparison: Horizontal bars show the three-repetition overall mean scores of the four harnesses across the five benchmarks totaling 50 tasks, with error bars indicating ±1 sample standard deviation using denominator 3 - 1 = 2." /><figcaption>Figure 5 | Overall Score Comparison: Horizontal bars show the three-repetition overall mean scores of the four harnesses across the five benchmarks totaling 50 tasks, with error bars indicating ±1 sample standard deviation using denominator 3 - 1 = 2.</figcaption></figure>

Combining subset score distributions, per-task pass frequencies, and resource consumption reveals four main findings:

**First, performance diverges sharply across task domains, and the union of all 600 attempts separates the model capability ceiling from the harness optimization space.**

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/02-subset-bars.png" width="2880" height="3260" alt="Figure 6 | Score Comparison Across Five Subsets: Three-repetition mean scores and sample standard deviations across the 10 tasks in each of subsets A–E on a unified 0–100 scale, with black end caps showing ±1 sample standard deviation." /><figcaption>Figure 6 | Score Comparison Across Five Subsets: Three-repetition mean scores and sample standard deviations across the 10 tasks in each of subsets A–E on a unified 0–100 scale, with black end caps showing ±1 sample standard deviation.</figcaption></figure>

As shown in Figure 6, no single harness dominates all five subsets simultaneously. On Sec A Data Analysis, PenguinHarness ties for first at 70.00 ± 10.00 alongside DSH at 70.00 ± 0.00; on network-isolated Sec B Software Engineering, PenguinHarness achieves the highest subset score at 70.00 ± 10.00 with repetition scores of 60, 70, and 80, ahead of DSH at 63.33 ± 15.28, Pi at 60.00 ± 10.00, and Codex at 53.33 ± 5.77; on Sec C Automation Workflows, DSH leads at 36.67 ± 5.77 followed by PenguinHarness at 30.00 ± 10.00; on Sec E Terminal Tasks, Pi achieves the highest mean at 23.33 ± 15.28 compared to 20.00 ± 0.00 for PenguinHarness and 20.00 ± 10.00 for DSH; meanwhile, Sec D Scientific Computing is a shared bottleneck where every harness scores between 0.00 and 10.00.

Taking the union of all 600 attempts across the four harnesses and three repetitions gives 12 attempts per task: 19 of the 50 tasks were never solved in any of the 12 attempts—including 7 in Sec D Scientific Computing, 5 each in Sec C and Sec E, and 2 in Sec A—while the remaining 31 tasks were solved at least once by at least one harness, including 17 solved by all four harnesses and all 10 software engineering tasks in Sec B. This boundary separates base model capability from harness engineering: on the 19 zero-pass tasks, the fixed base model `DeepSeek-V4.1-Flash-1017` hits its domain ceiling in specialized scientific computing and complex systems, where swapping harnesses alone cannot manufacture domain knowledge; conversely, within the 31 tasks the model is already capable of solving—corresponding to a 62-point theoretical ceiling—single repetitions average only 30.00 to 38.67 points, losing more than 23 points entirely to execution instability.

**Second, the number of tasks solved at least once is nearly identical across harnesses; what separates overall scores is whether unstable tasks pass twice out of three runs or only once.**

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/09-pass-frequency.png" width="2880" height="1330" alt="Figure 7 | Pass Frequency Distribution: Tasks grouped by pass count across three repetitions into 0/3, 1/3, 2/3, and 3/3 tiers, with the total number of distinct tasks passed at least once annotated on the right." /><figcaption>Figure 7 | Pass Frequency Distribution: Tasks grouped by pass count across three repetitions into 0/3, 1/3, 2/3, and 3/3 tiers, with the total number of distinct tasks passed at least once annotated on the right.</figcaption></figure>

| Harness | Passed 3 / 3 | Passed 2 / 3 | Passed 1 / 3 | Passed ≥ 1 | Passed 0 / 3 | Sec B: 3/3 / 2/3 / 1/3 |
| --- | --- | --- | --- | --- | --- | --- |
| PenguinHarness | 10 tasks | 12 tasks | 3 tasks | 25 tasks | 25 tasks | 3 / 5 / 2 tasks, 10 / 10 passed |
| DSH | 13 tasks | 7 tasks | 5 tasks | 25 tasks | 25 tasks | 2 / 5 / 3 tasks, 10 / 10 passed |
| Pi | 11 tasks | 5 tasks | 8 tasks | 24 tasks | 26 tasks | 4 / 2 / 2 tasks, 8 / 10 passed |
| Codex | 8 tasks | 7 tasks | 7 tasks | 22 tasks | 28 tasks | 2 / 4 / 2 tasks, 8 / 10 passed |

As shown in Figure 7 and the table above, if we only count distinct tasks passed at least once across three repetitions, PenguinHarness and DSH both solve 25 tasks, Pi solves 24, and Codex solves 22—a spread of at most 3 tasks. Yet among those 22–25 solvable tasks, 12–15 are unstable tasks that pass in only 1 or 2 repetitions, accounting for 48%–64% of each harness's solved set with markedly different internal frequency distributions:

- **Distinct stability profiles at the same score tier between PenguinHarness and DSH**: Both solve 25 distinct tasks and differ by just 1 total passed attempt, but DSH locks 13 tasks into the 3/3 tier, whereas PenguinHarness concentrates 12 of its 15 unstable tasks—80%—into the 2/3 tier with only 3 tasks in the 1/3 tier.
- **Why Pi trails the top two**: Pi achieves 11 tasks at 3/3—one more than PenguinHarness—and solves 24 tasks at least once, yet its overall mean trails the top two by 4.00–4.67 points because 8 of its 13 unstable tasks remain stuck at 1/3 while only 5 reach 2/3.
- **High-frequency oscillation in Sec B Software Engineering**: In Sec B, both PenguinHarness and DSH solve all 10 tasks at least once across three repetitions, yet only 3 and 2 tasks pass all three times while 5 tasks in each group land at 2/3. For these software engineering tasks, the primary bottleneck is not problem-solving capability, but the stability of multi-turn code editing and regression verification.

**Third, an identical three-run mean with a 0.00 standard deviation does not mean the harness solved the exact same tasks in every repetition.**

Consider PenguinHarness's per-task record on Sec E in Figure 8: it passes 2 out of 10 tasks in every repetition for a subset mean of 20.00 ± 0.00, yet only `CASE-008 Embedding Drift Monitor` passes all three times; the second pass comes from `CASE-010 FreeCAD Platform Modeling` in Run 1, and switches to `CASE-004 MVCC / LSM Compaction` in Runs 2 and 3.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/07-task-stability.png" width="2880" height="1560" alt="Figure 8 | Per-Task Stability Within a Single Subset: PenguinHarness per-task scores on Sec E Terminal-Bench 4.0. All three runs pass 2 / 10 tasks for a mean ± SD of 20.00 ± 0.00, but Run 1 passes CASE-010 FreeCAD Platform Modeling while Runs 2 and 3 pass CASE-004 MVCC / LSM Compaction." /><figcaption>Figure 8 | Per-Task Stability Within a Single Subset: PenguinHarness per-task scores on Sec E Terminal-Bench 4.0. All three runs pass 2 / 10 tasks for a mean ± SD of 20.00 ± 0.00, but Run 1 passes CASE-010 FreeCAD Platform Modeling while Runs 2 and 3 pass CASE-004 MVCC / LSM Compaction.</figcaption></figure>

Inspecting all four non-zero subset experiments with a 0.00 standard deviation shows that only DSH on Sec A at 70.00 ± 0.00 passes the exact same 7 tasks across all three repetitions; the other three groups all exhibit task-level swaps that cancel out in the subset total. Beyond PenguinHarness on Sec E in Figure 8, Codex on Sec A at 60.00 ± 0.00 swaps CASE-002 and CASE-007 in Run 2, and on Sec D at 10.00 ± 0.00 has zero 3/3 tasks—passing CASE-010 Asteroid Orbit Determination in Run 1 and CASE-003 Brain Image Registration in Runs 2 and 3 to produce three 10-point totals.

**Fourth, prefix cache reads exceed 98.5% of total input tokens, so single-repetition API cost differences from $2.91 to $4.07 are driven primarily by output tokens and heavy subsets.**

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08-resource-comparison.png" width="2880" height="1640" alt="Figure 9 | Single-Repetition Cost and Runtime Comparison: Three-repetition average API cost and cumulative agent runtime for completing all 50 tasks across the four harnesses." /><figcaption>Figure 9 | Single-Repetition Cost and Runtime Comparison: Three-repetition average API cost and cumulative agent runtime for completing all 50 tasks across the four harnesses.</figcaption></figure>

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08b-token-comparison.png" width="2880" height="2260" alt="Figure 10 | Single-Repetition Token Breakdown: Three-repetition average uncached input, cache read, and output token usage for completing all 50 tasks across the four harnesses, in millions of tokens." /><figcaption>Figure 10 | Single-Repetition Token Breakdown: Three-repetition average uncached input, cache read, and output token usage for completing all 50 tasks across the four harnesses, in millions of tokens.</figcaption></figure>

| Harness | API Cost | Cumulative Runtime | Uncached Input | Cache Read / Hit Rate | Output Tokens |
| --- | --- | --- | --- | --- | --- |
| PenguinHarness | ≈ $4.07 | 11.85 h / 42,670 s | 3.21 M | 351.86 M / 99.1% | 4.56 M |
| DSH | ≈ $3.82 | 11.03 h / 39,711 s | 3.90 M | 357.42 M / 98.9% | 3.91 M |
| Pi | ≈ $3.11 | 10.82 h / 38,942 s | 3.43 M | 232.54 M / 98.5% | 3.41 M |
| Codex | ≈ $2.91 | 9.51 h / 34,252 s | 3.51 M | 271.18 M / 98.7% | 2.86 M |

As shown in Figures 9 and 10 and the table above, all four harnesses process between 236M and 361M total input tokens per repetition, but because multi-turn tool calls continually reuse the long conversation prefix, 98.5%–99.1% of input tokens are low-cost cache reads while uncached input stays within a narrow 3.21M–3.90M band. Consequently, total API cost ranks in the exact same order as higher-priced output token usage.

Broken down by subset, cost and runtime concentrate in two heavy task categories: first, on Sec B Software Engineering, PenguinHarness and DSH generate 1.45M and 0.88M output tokens corresponding to subset costs of $1.48 and $1.06—above Pi's $0.83 and Codex's $0.82—where heavier multi-turn interaction yields higher subset scores, though separating productive verification from redundant retries requires trajectory-level analysis; second, on Sec D Scientific Computing, the 10 tasks consume 34%–53% of each group's entire cumulative runtime, totaling 4.03–5.15 hours or 24–31 minutes per task on average, while every group scores 10.00 or below. In the per-task duration logs preserved for DSH and Codex, 10 / 30 and 12 / 30 attempts respectively ran past 35 minutes, approaching the 40-minute timeout.

**Next Steps: What Will This Baseline Check?**

With per-task breakdowns completed across all 50 tasks, this suite serves as a fixed regression baseline for evaluating harness engineering improvements across three dimensions:

- **Convergence of high-frequency unstable tasks**: Comparing trajectories across Sec A, Sec B, and Sec C to test whether prompt and self-verification improvements convert 2/3 unstable tasks into consistent 3/3 passes while reducing output token overhead on Sec B.
- **Task-matrix regression checks**: Comparing the full three-run per-task pass matrix on every iteration so task-level swaps between repetitions cannot mask regressions behind an unchanged mean.
- **Execution efficiency on long-running subsets**: Tracking per-task duration distributions and termination states on Sec D to verify whether timeout reminders or early-stopping mechanisms curtail unproductive long runs.

Meanwhile, RSI experiments that require strict protection against overfitting on public tasks are conducted on the GDPevo benchmarks, which maintain separate training sets and held-out test sets.

*Experiment Data Snapshot: All data in this post corresponds to repository snapshot `6ad65ea054fe8035c1c48724dbb5626d699f6cb2` of [Prism-Shadow/penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2). Related documentation: [Comparison Archive](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/experiments/harness-comparison), [Repository Guide README.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/README.zh.md), [50-Task Selection Guide SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md), [Benchmark Package Guide packages/README.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/packages/README.zh.md), [PenguinAgent Adapter Guide](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/agents/README.md), [Evaluation Data and Submission Workflow Specification](https://club.penguin.ooo/zh/workflow/evaluation/)*
