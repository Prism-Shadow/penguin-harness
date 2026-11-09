---
title: "Comparing Four Popular Harnesses on 50 Real-World Tasks with PenguinHarness"
date: 2026-11-05
category: practice
author: "Zhihao Liu (Prism Shadow AI)"
excerpt: "We hold the model and thinking effort fixed and compare PenguinHarness, DSH, Pi and Codex on 50 tasks from five benchmarks over three runs. We examine pass rates, repeatability and resource use, and show how to organize and reproduce the evaluation with PenguinHarness."
---

When an agent fails at coding or data analysis, we often blame the model: it still is not smart enough. How much could the result change if we kept the model fixed and swapped the Harness around it? To measure that difference, we created an agent in PenguinHarness to organize an experiment. It used Harbor containers to test DSH, PenguinHarness, Pi and Codex on 50 tasks, with three runs per Harness: 600 task attempts in total. This post describes how we organized the experiment in PenguinHarness and four observations from those 600 records.

## 1. Benchmarks and experiment rules

To compare the Harnesses, we first fixed the other experimental settings. All four groups used DeepSeek-V4.1-Flash-1017 with thinking effort set to max. Harbor 0.23.0 ran each of the 50 tasks three times in isolated Docker containers:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/03-experiment-design.png" width="2880" height="1730" alt="Figure 1: Three-run experiment design for four Harnesses on 50 fixed tasks" /><figcaption>Figure 1: Three-run experiment design for four Harnesses on 50 fixed tasks</figcaption></figure>

We selected these 50 tasks from 864 candidates across five public benchmarks. Two rounds of screening and trial runs produced the final set. The complete selection record is in [SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md):

1. **First, select 50 tasks within the hardware and cost limits**: Exclude tasks that require GPUs, multiple containers, more than 8 GB of memory or large model-weight downloads during execution. The full set must run on a standard CPU-only machine, with an off-peak API budget of no more than $20 for three runs of all 50 tasks.
2. **Then, use an earlier release to calibrate difficulty**: Run the initial selection with PenguinHarness 0.2.13. Replace tasks in subsets whose scores are close to saturation with harder ones, and adjust the scientific computing subset, which initially scored zero throughout. The final set contains five subsets, A through E, with 10 tasks each:

| Subset | Upstream benchmark | What it tests | Time limit per task | Request limit |
| --- | --- | --- | --- | --- |
| Sec A | Data Analysis Bench | Clean and analyze information across documents, spreadsheets and databases, then report findings | 15m | 100 |
| Sec B | DeepSWE v1.1 | Locate defects in real open-source repositories, write patches and pass regression tests | 30m | 250 |
| Sec C | AutomationBench | Complete multistep workflows through business-system and local-service APIs | 10m | 50 |
| Sec D | Terminal-Bench-Science 0.1 | Perform scientific computing and modeling in a Linux terminal, including astrophysics and bioinformatics | 40m | 320 |
| Sec E | Terminal-Bench 4.0 | Troubleshoot systems, repair storage engines and debug builds in a real terminal | 25m | 200 |

## 2. Start the experiment in four steps with Penguin

Running 600 containerized trials involves network setup, offline installation bundles, concurrency limits, failed-start retries and YAML reports for 20 experiment groups. We can delegate that work to a dedicated agent in the PenguinHarness interface, including the scripts that coordinate the experiment.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/04-penguin-reproduction-flow.png" width="2880" height="1740" alt="Figure 2: Using PenguinHarness to coordinate repeat experiments for all four Harnesses" /><figcaption>Figure 2: Using PenguinHarness to coordinate repeat experiments for all four Harnesses</figcaption></figure>

Reproducing this workflow in the PenguinHarness web interface takes four steps:

**Step 1: Connect the model in Models**

Open Models in the left sidebar. Under DeepSeek, open the DeepSeek V4.1 Flash settings, enter the API key and endpoint https://api.deepseek.com, select Set as default model at the top, and save:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_01_model_config.png" width="2372" height="1544" alt="Connect DeepSeek V4.1 Flash in Models and set it as the default" /><figcaption>Connect DeepSeek V4.1 Flash in Models and set it as the default</figcaption></figure>

**Step 2: Create a dedicated Harness Evaluation agent**

Open Agents and select Create manually in the upper-right corner. Enter Harness Evaluation as the name and harness_evaluation as the Agent ID, then select Create agent:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_02_create_agent.png" width="1776" height="1524" alt="Manually create the Harness Evaluation agent" /><figcaption>Manually create the Harness Evaluation agent</figcaption></figure>

Once the agent appears in the list, select + New chat beside Harness Evaluation:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_03_agents_list.png" width="1774" height="834" alt="Start a new chat from the Agents list" /><figcaption>Start a new chat from the Agents list</figcaption></figure>

**Step 3: Select max thinking effort and send the experiment prompt**

In the new chat, confirm that Harness Evaluation and the working directory are selected at the bottom left. At the bottom right of the input box, select DeepSeek V4.1 Flash and set thinking effort to max:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_04_chat_box.png" width="1834" height="836" alt="Select the evaluation agent, working directory, max thinking effort and model in a new chat" /><figcaption>Select the evaluation agent, working directory, max thinking effort and model in a new chat</figcaption></figure>

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

**Step 4: Run the experiment and generate summary reports**

After receiving the prompt, the Harness Evaluation agent downloads the repository, validates the environment on one task and runs the three repetitions in batches. It then checks for containers that failed to start and generates score and resource summaries for all four Harnesses. The 600 completed attempts analyzed here are archived under experiments/harness-comparison/ in the repository.

## 3. How a task runs and receives a score

We apply three rules outside the task containers to keep environment differences from favoring any Harness:

1. **Mount offline installation bundles**: Package each Harness in advance. When a container starts, mount and extract its bundle into a separate directory, leaving the task's existing Python and Node environments intact.
2. **Isolate open-source bug-fixing tasks from the internet**: Sec B uses historical defects from real open-source repositories. To prevent agents from retrieving existing fixes from upstream PRs or issues, its containers have no public internet access. Only the model API domain is allowed.
3. **Retry failed starts; keep incorrect answers and timeouts**: Check each run afterward. An environment failure qualifies for a retry when the container never started or the agent never sent its first request. Once the agent begins working, errors and timeouts count toward its result; those attempts are not rerun to improve the score.

Figure 3 shows the separation between task execution and grading. The agent reads code, edits files and calls tools in the container's /app directory. After it exits, the grading script checks the resulting files in /app. Passing every test earns 100 points; any failed test gives a score of 0:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/05-trial-execution.png" width="2880" height="1570" alt="Figure 3: Container execution and independent grading for a single task" /><figcaption>Figure 3: Container execution and independent grading for a single task</figcaption></figure>

For example, Sec E task 8, [embedding-drift-monitor](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/data/penguinharness-benchmark-sec-e/tasks/embedding-drift-monitor), asks the agent to repair a monitoring program containing three logic and calculation bugs. Each Harness has 25 minutes and 200 requests to inspect the code and fix the problems before the grader runs pytest. Codex ended all three attempts after treating the work as complete, yet its changes failed pytest and scored 0 each time. DSH and PenguinHarness passed the tests in all three attempts, scoring 100 in each run.

## 4. How scores and resource use are calculated

Once all 600 attempts finish, we aggregate scores and resource use. Each Harness completes 150 attempts across three runs. One additional passing attempt raises its three-run average overall score by 0.67 points. Figure 4 shows the calculation:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/06-statistics-method.png" width="2880" height="2392" alt="Figure 4: Calculating the overall mean and sample standard deviation" /><figcaption>Figure 4: Calculating the overall mean and sample standard deviation</figcaption></figure>

For resource use, we sum API cost, cumulative agent runtime and token usage across the 50 tasks in each run, then average those totals over the three runs. Tokens are counted in three billing categories: uncached input, cache reads and model output.

## 5. Four observations from the results

The overall scores provide a starting point:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/01-overall-bars.png" width="2880" height="1140" alt="Figure 5: Overall scores for four Harnesses across three runs" /><figcaption>Figure 5: Overall scores for four Harnesses across three runs</figcaption></figure>

DSH and PenguinHarness, the top two on this chart, differ by just 0.67 points. Across 150 attempts each, that is 58 passes versus 57: a difference of one passing attempt. The other overall scores also look fairly close at first glance. Breaking the results down by subset, per-task pass frequency and resource use reveals further differences among the four Harnesses.

**Observation 1: PenguinHarness performs best on software engineering tasks**

The five-subset breakdown shows which kinds of tasks each Harness handles best:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/02-subset-bars.png" width="2880" height="3260" alt="Figure 6: Scores for four Harnesses across five subsets" /><figcaption>Figure 6: Scores for four Harnesses across five subsets</figcaption></figure>

In Figure 6, PenguinHarness has its clearest advantage on Sec B Software Engineering, which requires fixing bugs without internet access. It leads that subset with 70.00 points and ties DSH at 70.00 on Sec A Data Analysis. DSH leads Sec C Automation, while Pi leads Sec E Terminal Troubleshooting. Even with the model fixed, changing the Harness affects how well the agent handles different task types. Across all four Harnesses and three runs, the model solved 31 of the 50 tasks, or 62%; 19 tasks remained unsolved by every Harness. Only 17 of those 31 tasks were solved by all four. Of the remaining 14, nine were solved by two or three Harnesses, and five by just one.

When an agent fails, the execution trace can help locate tool-design or context-feedback issues that may be limiting capabilities the model has shown elsewhere.

**Observation 2: PenguinHarness and DSH tie on Pass@3, while inconsistent execution lowers their average scores**

A single Harness passes an average of 15 to 19.3 tasks per run. Giving it three attempts reveals a different measure: how many tasks it can solve at least once. We count each task's passes across the three runs. Passing at least once is the **Pass@3** measure in Figure 7; passing all three times indicates consistent success across those runs.

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/09-pass-frequency.png" width="2880" height="1330" alt="Figure 7: Per-task pass frequencies across three runs of 50 tasks" /><figcaption>Figure 7: Per-task pass frequencies across three runs of 50 tasks</figcaption></figure>

DSH and PenguinHarness each solve 25 tasks at least once, tying for first place. Of PenguinHarness's 25 solved tasks, only 10 pass all three times. Another 12 tasks pass twice and fail once. Converting those 12 failures into passes, with no regressions elsewhere, would add 8 points without solving any new tasks. Take the software engineering subset: DSH and PenguinHarness each fix every task at least once, so neither leaves a task unsolved across all three runs. Yet only 2 and 3 tasks respectively pass every time. For practical use, succeeding once is insufficient. Adding a check before submission to turn two passes out of three into three out of three is a key target for improving scores.

**Observation 3: Identical scores can hide different passing tasks**

Among the 20 subset experiments, two score 0 in every run. Beyond those, four groups produce exactly the same score in all three runs, with a standard deviation of 0.00. That does not establish consistent results on individual tasks. PenguinHarness scores 20 points in each Sec E run, for example:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/07-task-stability.png" width="2880" height="1560" alt="Figure 8: PenguinHarness per-task pass records across three Sec E runs" /><figcaption>Figure 8: PenguinHarness per-task pass records across three Sec E runs</figcaption></figure>

Figure 8 shows that only CASE-008 passes all three times. The other 10 points come from CASE-010 in Run 1 and CASE-004 in Runs 2 and 3. Among the other three groups with identical scores across runs, only DSH on Sec A passes the same seven tasks every time for 70 points. The remaining two groups also have task-level swaps that leave the total unchanged. Codex on scientific computing is an even clearer example: it scores 10 in every run, yet no task passes all three times.

When iterating on an agent, running only once after a prompt or tool change, or tracking only the total score, obscures the difference between an improvement and a trade-off that fixes task A while breaking task B. Random variation can easily look like progress.

**Observation 4: More tokens do not always mean higher scores; bug-fixing tasks improve with longer runs, while scientific computing tasks can run out of time without passing**

Figures 9 and 10 compare the cost, runtime and three token categories for a complete run of 50 tasks, from lowest to highest:

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08-resource-comparison.png" width="2880" height="1640" alt="Figure 9: API cost and cumulative runtime for one run of 50 tasks" /><figcaption>Figure 9: API cost and cumulative runtime for one run of 50 tasks</figcaption></figure>

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08b-token-comparison.png" width="2880" height="2260" alt="Figure 10: Three token categories for one run of 50 tasks" /><figcaption>Figure 10: Three token categories for one run of 50 tasks</figcaption></figure>

About 99% of input tokens hit the cache for all four Harnesses, so output tokens drive most of the differences in API cost. Whether more output and runtime correspond to a higher score depends on the task category:

1. **On Sec B Software Engineering, higher token use accompanies higher scores**: PenguinHarness produces 1.45 M output tokens per run on these 10 tasks, costs $1.48 and leads the subset with 70.00 points. DSH, Pi and Codex use progressively fewer output tokens and spend less, with scores decreasing in the same order. We suspect this relates to the ability to run tests while editing code and use failures to guide further changes.
2. **On Sec D Scientific Computing, much of the runtime is spent on attempts that time out**: These 10 tasks account for 34% to 53% of each Harness's cumulative runtime, taking roughly 4 to more than 5 hours per run, while every Harness scores 10 or below. DSH and Codex retain per-task duration records: 10 and 12 of their 30 attempts respectively exceed 35 minutes. Of those 22 long attempts, 21 score 0. The exception is Codex's asteroid orbit determination attempt, which takes 38.8 minutes and scores 100. Long runs can succeed; the execution trace is needed to distinguish progress from repeated dead ends.

The value of additional tokens therefore depends heavily on whether the task provides clear feedback. In bug-fixing tasks, agents can run tests and use errors to improve their changes over further attempts. For long scientific computing tasks without intermediate correctness feedback, simply increasing the step and time budgets often adds unsuccessful attempts. Detecting where the agent is stuck and prompting it to change approach or stop is more useful than increasing token use alone.

Experiment data snapshot: All data in this post corresponds to snapshot 6ad65ea054fe8035c1c48724dbb5626d699f6cb2 of [Prism-Shadow/penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2). Related documentation: [Comparison archive](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/experiments/harness-comparison), [Repository guide README.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/README.zh.md), [50-task selection guide SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md), [Benchmark data guide data/README.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/data/README.md), [PenguinAgent adapter guide](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/agents/README.md), [Evaluation data and submission workflow](https://club.penguin.ooo/zh/workflow/evaluation/).
