---
title: "Comparing Harness Capabilities and Cost-Effectiveness with PenguinHarness"
date: 2026-11-05
category: practice
author: "Zhihao Liu (Prism Shadow AI)"
excerpt: "We hold the model and thinking effort fixed and compare PenguinHarness, DSH, Pi and Codex on 50 tasks from five benchmarks over three runs. We examine pass rates, repeatability and resource use, and show how to organize and reproduce the evaluation with PenguinHarness."
---

This post describes how to use PenguinHarness 0.2.19 to organize a comparison of different Harnesses. We selected 50 tasks from five public benchmarks, fixed the model to DeepSeek-V4.1-Flash-1017 with thinking effort set to max, and tested PenguinHarness, DSH, Pi and Codex over 3 runs each. We cover the benchmark construction and experiment rules, the evaluation workflow, and the results and analysis.

## 1. Benchmarks and experiment settings

Every task runs in an isolated Docker container. Figure 1 shows the versions of the four evaluated Harnesses and the composition of the test set.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/03-experiment-design.png" width="2880" height="1650" alt="Figure 1: The four Harnesses and the composition of the test set" /><figcaption>Figure 1: The four Harnesses and the composition of the test set</figcaption></figure>

We selected these 50 tasks from the five benchmarks above for a CPU-only, single-machine environment with an 8 GB memory limit, choosing tasks that distinguish performance at different difficulty levels. The full selection criteria are in [SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md). The test set contains five subsets, Sec A through Sec E, with 10 tasks each. Their sources, focus and per-task budgets are listed below:

| Subset | Upstream benchmark | What it tests | Time limit per task | Request limit |
| --- | --- | --- | --- | --- |
| Sec A | Data Analysis Bench | Clean and analyze information across documents, spreadsheets and databases, then report findings | 15m | 100 |
| Sec B | DeepSWE v1.1 | Locate defects in real open-source repositories, write patches and pass regression tests | 30m | 250 |
| Sec C | AutomationBench | Complete multistep workflows through business-system and local-service APIs | 10m | 50 |
| Sec D | Terminal-Bench-Science 0.1 | Perform scientific computing and modeling in a Linux terminal, including astrophysics and bioinformatics | 40m | 320 |
| Sec E | Terminal-Bench 4.0 | Troubleshoot systems, repair storage engines and debug builds in a real terminal | 25m | 200 |

To prevent environmental interference and keep the comparison fair, we follow three rules:

1. **Mount offline runtime bundles**: Each Harness is packaged in an offline archive in advance. When a container starts, its bundle is mounted, extracted into a separate directory and run without modifying the Python or Node environment supplied with the task.
2. **Restrict network access for open-source bug-fixing tasks**: Sec B tasks come from historical bugs in open-source repositories. To prevent agents from finding existing fixes in upstream PRs or issues, these containers block public internet access and allow only model API requests.
3. **Rerun only when the environment fails to start**: Container status is checked automatically after each run. A container that fails to start is treated as an environment failure and rerun. Once the agent has started working on the task, errors or timeouts count toward the result and do not trigger a rerun.

## 2. Organizing the experiment with PenguinHarness

The experiment requires network configuration, offline bundles, concurrency control, failed-start retries and YAML reports. We create a dedicated agent in PenguinHarness to organize these steps. Figure 2 shows the overall workflow:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/04-penguin-reproduction-flow.png" width="2880" height="1500" alt="Figure 2: Organizing the comparison with PenguinHarness" /><figcaption>Figure 2: Organizing the comparison with PenguinHarness</figcaption></figure>

Follow these three steps in the PenguinHarness web interface to reproduce the experiment:

**Step 1: Configure the default model**

Open Models in the left sidebar. Under DeepSeek, open the DeepSeek V4.1 Flash settings, enter the API key and endpoint https://api.deepseek.com, set it as the default model, and save:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_01_model_config.png" width="2372" height="1544" alt="Connect DeepSeek V4.1 Flash in Models and set it as the default" /><figcaption>Connect DeepSeek V4.1 Flash in Models and set it as the default</figcaption></figure>

**Step 2: Create an agent to organize the experiment**

Open Agents and select Create manually in the upper-right corner. Enter Harness Evaluation as the name and harness_evaluation as the Agent ID, then select Create in the lower-right corner:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_02_create_agent.png" width="1776" height="1524" alt="Manually create the Harness Evaluation agent" /><figcaption>Manually create the Harness Evaluation agent</figcaption></figure>

Once the agent appears in the list, select + New chat beside Harness Evaluation:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_03_agents_list.png" width="1774" height="834" alt="Start a new chat from the Agents list" /><figcaption>Start a new chat from the Agents list</figcaption></figure>

**Step 3: Set thinking effort and send the prompt**

In the new chat, confirm that Harness Evaluation and the working directory are selected at the bottom left. At the bottom right of the input box, select DeepSeek V4.1 Flash and set thinking effort to max:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_04_chat_box.png" width="1834" height="836" alt="Select Harness Evaluation, the working directory, thinking effort and the model in a new chat" /><figcaption>Select Harness Evaluation, the working directory, thinking effort and the model in a new chat</figcaption></figure>

Copy the complete experiment prompt below into the input box and send it:

```text
Please organize and reproduce a three-run comparison of four Harnesses with the following requirements:

1. Experiment repository and snapshot
- Clone https://github.com/Prism-Shadow/penguin-harness-benchmark.git and check out snapshot 6ad65ea054fe8035c1c48724dbb5626d699f6cb2.
- Read README.zh.md, SELECTION.zh.md, data/README.md and agents/README.md to check the task directories and subset configurations for all 50 tasks.

2. Evaluated Harnesses, shared model and thinking effort
- Use Harbor 0.23.0 as the runner throughout.
- Evaluate these Harness versions: DSH 0.2.1-rc.2, PenguinHarness 0.2.17, Pi 1.4.0 and Codex 0.162.1.
- Use deepseek/DeepSeek-V4.1-Flash-1017 for every Harness and verify that each adapter's actual configuration enables max thinking effort.

3. Five subsets, repetition count and per-task budgets
- Run each of the 50 tasks independently 3 times: 10 tasks in each subset from Sec A through Sec E, 150 attempts per Harness and 600 attempts in total.
  - Sec A: data/penguinharness-benchmark-sec-a, 10 tasks, 15m per task, 100 requests; allow public internet access and reuse the shared penguin-bench network.
  - Sec B: data/penguinharness-benchmark-sec-b, 10 tasks, 30m per task, 250 requests; disable public internet access and allow only the model API host through --allow-agent-host.
  - Sec C: data/penguinharness-benchmark-sec-c, 10 tasks, 10m per task, 50 requests; allow public internet access and reuse the shared penguin-bench network.
  - Sec D: data/penguinharness-benchmark-sec-d, 10 tasks, 40m per task, 320 requests; allow public internet access and reuse the shared penguin-bench network.
  - Sec E: data/penguinharness-benchmark-sec-e, 10 tasks, 25m per task, 200 requests; allow public internet access and reuse the shared penguin-bench network.

4. Environment and adapter preparation, single-task validation and batch execution
- Create the shared Docker network penguin-bench and build the offline installation bundles. The repository's agents/ directory includes the penguin_agent:PenguinAgent adapter. Before reproducing the DSH, Pi and Codex runs, verify and prepare their corresponding Harbor InstalledAgent adapters and offline bundles.
- First run embedding-drift-monitor from data/penguinharness-benchmark-sec-e/tasks with concurrency set to 1. Confirm that bundle extraction, model calls, artifact creation and independent verifier grading all work.
- After that check passes, run the four Harness groups in sequence across all five subsets for three runs, keeping total concurrency on the machine at or below 4.

5. Failure checks and result aggregation
- After each run, use tools/measure/reruns.py to identify and retry trials that never actually started. Produce meta_info.yaml, test/attempt-1..3.yaml and test/summary.yaml for each Harness and subset, then summarize scores, per-task pass frequencies and resource use across all four Harnesses.
```

After receiving the instruction, the Harness Evaluation agent clones the repository and runs the single-task environment check. It then completes three runs within the concurrency limit, retries containers that failed to start after each run, and produces score, execution-time and cost comparisons for the four Harnesses. All 600 task-attempt records analyzed in this post are archived under [experiments/harness-comparison/](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/experiments/harness-comparison).

## 3. Task execution and grading

Task execution and grading are separate stages within the container, as Figure 3 shows. The agent reads code, edits files and calls tools in /app. Only after the agent process exits does the grading script enter /app and run the acceptance tests. Grading depends solely on the final result: passing every test earns 100 points; failing any test earns 0.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/05-trial-execution.png" width="2880" height="1370" alt="Figure 3: Container execution and grading for a single task" /><figcaption>Figure 3: Container execution and grading for a single task</figcaption></figure>

Consider CASE-008 in Sec E. Its container includes a drift-monitoring program with multiple logic and calculation defects. The agent has 25 minutes and 200 requests to repair it, after which the acceptance script runs pytest to grade the result. Across three attempts at this task, Codex's modified code failed pytest every time and scored 0 in all three runs. Pi passed twice. DSH and PenguinHarness passed all the tests in all three runs, earning 100 points each time.

## 4. Score, execution-time and cost statistics

Each Harness runs the 50 tasks three times, for 150 attempts in total. Figure 4 shows how we calculate the overall mean and sample standard deviation:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/06-statistics-method.png" width="2880" height="2090" alt="Figure 4: Calculating the overall mean and sample standard deviation" /><figcaption>Figure 4: Calculating the overall mean and sample standard deviation</figcaption></figure>

API cost, execution time and token use are first summed across the 50 tasks in each run, then averaged across the three runs. Token use is counted separately in three billing categories: non-cached input, cache reads and model output.

## 5. Results and analysis

Figure 5 shows the overall scores across three runs of the 50 tasks for each Harness:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/01-overall-bars.png" width="2880" height="956" alt="Figure 5: Overall scores for the four Harnesses" /><figcaption>Figure 5: Overall scores for the four Harnesses</figcaption></figure>

DSH and PenguinHarness average 38.67 ± 1.15 and 38.00 ± 2.00 points respectively, with 58 and 57 passes out of 150 attempts. Pi and Codex average 34.00 ± 3.46 and 30.00 ± 2.00 points, with 51 and 45 passes. The top two are very close in overall mean score. We examine the results across four dimensions: the five task subsets, per-task pass frequencies, task outcomes in runs with equal scores, and resource use.

### 5.1 Scores across the five subsets

Figure 6 breaks the overall scores down by task type across Sec A through Sec E:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/02-subset-bars.png" width="2880" height="3180" alt="Figure 6: Scores across the five subsets" /><figcaption>Figure 6: Scores across the five subsets</figcaption></figure>

Figure 6 shows that an overall leader does not lead on every task type. Each Harness has different strengths: PenguinHarness scores highest on Sec B, software engineering, and ties with DSH for first on Sec A, data analysis. DSH leads on Sec C, automated workflows; Pi leads on Sec E, terminal troubleshooting; and Codex scores highest on Sec D, scientific computing.

### 5.2 Pass@3 and reliability

We count how often each task passes across the three runs. Passing at least once counts toward Pass@3 in Figure 7 and demonstrates the ability to solve that task. Passing all three times indicates consistent success.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/09-pass-frequency.png" width="2880" height="1250" alt="Figure 7: Pass frequencies across three runs of 50 tasks" /><figcaption>Figure 7: Pass frequencies across three runs of 50 tasks</figcaption></figure>

Figure 7 shows that DSH and PenguinHarness each solve 25 tasks at least once across three runs, tying for first. DSH is the most consistent, passing 13 tasks in all three runs. PenguinHarness passes only 10 tasks in all three runs, while another 12 tasks pass twice. If those 12 tasks passed in every run, PenguinHarness's overall mean would rise by 8 points without solving any new tasks. Improving reliability is also a priority when we optimize Harnesses for real applications.

### 5.3 Per-task outcomes when overall scores are equal

PenguinHarness scores 20 points in each of its three runs on Sec E, with a standard deviation of 0. Figure 8 shows each task's score in those runs:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/07-task-stability.png" width="2880" height="1480" alt="Figure 8: Per-task scores for PenguinHarness across three runs of Sec E" /><figcaption>Figure 8: Per-task scores for PenguinHarness across three runs of Sec E</figcaption></figure>

Although all three runs score 20 points, only CASE-008 passes every time. In run 1, the other 10 points come from CASE-010; in runs 2 and 3, they come from CASE-004. An unchanged total can conceal changes in individual task outcomes.<br />The same applies when optimizing a Harness: a change may leave the total score unchanged while some task scores rise and others fall. We need to examine where scores changed and why, retain effective changes and address regressions to improve the total.

### 5.4 Resource use and scores

Figures 9 and 10 compare API cost, cumulative execution time and token use for one run of 50 tasks:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08-resource-comparison.png" width="2880" height="1560" alt="Figure 9: API cost and execution time for one run of 50 tasks" /><figcaption>Figure 9: API cost and execution time for one run of 50 tasks</figcaption></figure>

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08b-token-comparison.png" width="2880" height="2180" alt="Figure 10: Three token categories for one run of 50 tasks" /><figcaption>Figure 10: Three token categories for one run of 50 tasks</figcaption></figure>

Figures 9 and 10 show that the higher-scoring DSH and PenguinHarness use more execution time and output tokens. DSH costs less and takes less time than PenguinHarness, making it more cost-effective. Aggregate figures do not reveal where the additional time and tokens go, so we examined the execution logs for CASE-004 in Sec E, which asks agents to repair data loss after version compaction in a C++ storage engine. In both runs 1 and 3, DSH wrote tests after editing the code. Its own tests all passed in run 1, but missed edge cases: four independent acceptance tests failed. In run 3, randomized testing exposed inconsistent data in an edge case. DSH then used the logs to locate the cause and fix the logic. That attempt took nearly twice as long and used more tokens, but passed all 15 acceptance tests.<br />We should account for this when optimizing Harnesses. When a prompt merely asks the model to write tests after making changes, the model often writes conventional tests that follow the reasoning behind its patch and miss overlooked edge cases. Self-check instructions should therefore explicitly call for randomized tests and coverage of edge cases involving invalid inputs, concurrency and intermediate states.
