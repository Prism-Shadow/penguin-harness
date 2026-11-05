---
title: "Conducting Self-Evolution Experiments on GDPEVO with Penguin Harness"
date: 2026-11-04
category: practice
author: Leijun Zhou
excerpt: "Run and evaluate four agent self-evolution methods—SkillAdam, SkillOpt, TRACE, and OpenSkill—across the GDPEVO Essential benchmark series (six sub-benchmarks totaling 30 train tasks and 30 held-out test tasks) in PenguinHarness 0.2.19."
---

This guide explains how to use PenguinHarness 0.2.19 to run agent self-evolution experiments on the [GDPEVO Essential](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/leaderboards/gdpevo-essential) benchmark series. With the base model fixed to `DeepSeek-V4.1-Flash-1017` and thinking effort set to `max`, we systematically evaluate four self-evolution methods: [SkillAdam](https://arxiv.org/abs/2609.08944v1), [SkillOpt](https://arxiv.org/abs/2605.23904v1), [TRACE](https://arxiv.org/abs/2608.22793v2), and [OpenSkill](https://arxiv.org/abs/2606.06741v1). The sections below cover the structure and evaluation rules of the GDPEVO Essential benchmark series, the core self-evolution mechanism, the launch flow in the Web UI, the internal execution pipeline, and the empirical results.

## 1. Structure and Rules of the GDPEVO Essential Benchmark Series

GDPEVO Essential is a benchmark series designed for evaluating enterprise task solving and agent self-evolution, consisting of six independent sub-benchmarks with 30 training tasks and 30 held-out test tasks in total. In the [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data) repository and PenguinHarness's built-in benchmark library, each sub-benchmark is packaged as a paired training set and held-out test set containing 5 training tasks and 5 held-out test tasks:

| Benchmark | Benchmark ID | Tasks | Task Overview |
| :--- | :--- | :--- | :--- |
| Service Ticket Resolution | [service-ticket-resolution](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-service-ticket-resolution-train) | 5 Train / 5 Test | Query support backend records to verify and resolve pending tickets |
| Financial Control | [financial-control](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-financial-control-train) | 5 Train / 5 Test | Reconcile accounts and complete closing calculations from financial data |
| Portfolio Management | [portfolio-management](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-portfolio-management-train) | 5 Train / 5 Test | Read asset-management records to compute portfolio valuations and rebalancing plans |
| Coverage Review | [coverage-review](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-coverage-review-train) | 5 Train / 5 Test | Cross-check policy terms and claim submissions to issue coverage review decisions |
| Court Clerk Operations | [court-clerk-operations](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-court-clerk-operations-train) | 5 Train / 5 Test | Verify case filings and organize court scheduling and archiving records |
| Engineering Portfolio Analytics | [engineering-portfolio-analytics](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-engineering-portfolio-analytics-train) | 5 Train / 5 Test | Aggregate multi-project progress and resource metrics into portfolio analytics |

Under the GDPEVO Essential evaluation protocol, every sub-benchmark follows three core rules:

- **Independent Training and Testing per Benchmark**: The six sub-benchmarks are strictly independent. Each Benchmark runs its own training session and exports a dedicated `SKILL.md` document without mixing training data or sharing learned skills across Benchmarks.
- **Training Phase**: All 5 training tasks of a Benchmark run sequentially inside a single business container and one persistent Agent session under a 6-hour budget without resetting the workspace. The container serves a read-only business API on loopback and exposes an online judge endpoint `POST /api/judge` for diagnostic feedback. Whether to query this endpoint is determined by each self-evolution method: supervised methods use it to guide revisions, whereas unsupervised methods rely solely on self-constructed virtual tests.
- **Testing Phase**: Once exported, the learned `SKILL.md` is immediately frozen and evaluated across 3 full repetitions of the 5 held-out test tasks in that Benchmark, with a 4-hour budget per task. Every single test question in every repetition launches in a brand-new isolated container and clean session with the online training judge disabled, and is scored after completion by the offline verifier.

## 2. Self-Evolution Method: SkillAdam as an Example

In this study, we reproduced and adapted four recent academic self-evolution methods—[SkillAdam](https://arxiv.org/abs/2609.08944v1), [SkillOpt](https://arxiv.org/abs/2605.23904v1), [TRACE](https://arxiv.org/abs/2608.22793v2), and [OpenSkill](https://arxiv.org/abs/2606.06741v1)—into built-in PenguinHarness plugins so they can be evaluated side by side under identical container isolation and grading rules.

We use our adaptation of [SkillAdam](https://arxiv.org/abs/2609.08944v1) to illustrate how in-container evolution works. During continuous training, the target Agent iteratively refines `SKILL.md` across the 5 training tasks. Allowing an LLM to freely rewrite the entire skill document after every round leads to two recurring failure modes in practice: without a persistent record of failed edits, the model repeatedly retries directions that were already disproven, and without step-size control, an aggressive edit that fixes one question often overwrites rules that were working on the other questions.

To address both issues, SkillAdam adapts the Adam optimizer's "first-order momentum + second-order variance step-size scaling" into a four-step natural-language evolution loop inside the training container:

<figure class="post-figure" data-widget="skilladam-loop"><ol class="fig-steps"><li>5-Task Rollout: Target Agent runs T1–T5 to measure scores and per-task deltas</li><li>Strict Mean Gate: compares candidate mean against prior best to accept or reject the revision</li><li>Adam Controller: updates the first-moment EIT Issue Ledger and second-moment edit quota</li><li>Bounded Skill Edit: modifies only the unlocked lines of SKILL.md to produce the updated version</li></ol><figcaption>SkillAdam's four-stage evolution loop.</figcaption></figure>

- **Zero-Shot Attempt and Initial Distillation**: Training begins with a zero-shot pass over all 5 training tasks without any domain skill attached, distilling an initial `SKILL.md` from the execution trajectories and diagnostic feedback. In each subsequent round, the Agent evaluates the current or candidate skill across the training tasks to collect per-question scores, score deltas, and failure causes.
- **Evolving Issue Tracker (EIT)**: Throughout training, the algorithm maintains a persistent ledger tracking observed error patterns, attempted fixes, and their measured outcomes. Even when a candidate edit is rejected for failing to improve the mean score, that failed attempt is recorded in the EIT so later iterations do not repeat the same ineffective modification.
- **Variance-Adaptive Edit Budget**: After evaluating a candidate version on all 5 training tasks, the algorithm measures how much the score changes vary across questions. When an edit boosts some tasks while causing regressions on others, the high cross-task variance automatically shrinks the number of document blocks allowed to change in the next round, forcing the model toward localized adjustments.
- **Strict Mean Gate**: A candidate `SKILL.md` is accepted to replace the active version only if its mean score across all 5 training tasks is strictly higher than the current version, otherwise it is rejected and rolled back. When iterations finish, the last accepted `SKILL.md` is exported as the final artifact.

Specifically, in iteration <i>t</i>, let <i>s<sub>i</sub></i><sup>curr</sup> and <i>s<sub>i</sub></i><sup>cand</sup> denote the normalized scores on training task <i>i</i> before and after the candidate edit, with per-task score change Δ<sub><i>i</i></sub> = <i>s<sub>i</sub></i><sup>cand</sup> − <i>s<sub>i</sub></i><sup>curr</sup>. With mean change Δ̄ across the <i>n</i> = 5 training tasks, the sample variance of the score changes is:

<p align="center"><i>σ</i><sub>Δ</sub><sup>2</sup> = (1 / (<i>n</i> − 1)) ∑<sub><i>i</i>=1..<i>n</i></sub> (Δ<sub><i>i</i></sub> − Δ̄)<sup>2</sup></p>

The algorithm maintains an exponential moving average <i>V<sub>t</sub></i> of this variance with smoothing factor <i>β</i><sub>2</sub> = 0.9 (initialized at <i>V</i><sub>0</sub> = 0) and computes the maximum number of diff blocks <i>B</i><sub><i>t</i>+1</sub> permitted in the next round:

<p align="center"><i>V<sub>t</sub></i> = <i>β</i><sub>2</sub> <i>V</i><sub><i>t</i>−1</sub> + (1 − <i>β</i><sub>2</sub>) <i>σ</i><sub>Δ</sub><sup>2</sup>, <i>B</i><sub><i>t</i>+1</sub> = max(<i>B</i><sub>min</sub>, round(<i>B</i><sub>base</sub> · (1 − clip(<i>V<sub>t</sub></i> / <i>V</i><sub>cap</sub>, 0, 1))))</p>

where the base budget is <i>B</i><sub>base</sub> = 4, the minimum budget is <i>B</i><sub>min</sub> = 1, and the variance cap is <i>V</i><sub>cap</sub> = 0.1. When cumulative volatility <i>V<sub>t</sub></i> rises, the allowed edit budget contracts from 4 blocks down to 1–2 blocks, and recovers when score gains are consistent across tasks.

The chart and table below show the actual in-container training score progression (on a 100-point scale) across three sub-benchmarks—Engineering Portfolio Analytics, Coverage Review, and Court Clerk Operations:

<figure class="post-figure" data-figure="skilladam-progression"> <svg class="fig-svg" viewBox="0 0 560 220" role="img" aria-labelledby="gdpevo-self-evolution-skilladam-progression-en-title"> <title id="gdpevo-self-evolution-skilladam-progression-en-title">Five-task training mean score progression across iterations in three sub-benchmarks</title> <path d="M56 28H532M56 68H532M56 108H532M56 148H532" class="fig-link"/> <path d="M56 28V168H532" class="fig-axis"/> <text x="46" y="32" text-anchor="end" class="fig-tick">100</text> <text x="46" y="72" text-anchor="end" class="fig-tick">80</text> <text x="46" y="112" text-anchor="end" class="fig-tick">60</text> <text x="46" y="152" text-anchor="end" class="fig-tick">40</text> <text x="96" y="188" text-anchor="middle" class="fig-label">Zero-shot</text> <text x="224" y="188" text-anchor="middle" class="fig-label">Initial Skill</text> <text x="352" y="188" text-anchor="middle" class="fig-label">Iteration 1</text> <text x="480" y="188" text-anchor="middle" class="fig-label">Iteration 2</text> <path d="M96 129.5L224 78.3L352 33.3L480 28.0" class="fig-edge"/> <circle cx="96" cy="129.5" r="4" class="fig-s1"/> <circle cx="224" cy="78.3" r="4" class="fig-s1"/> <circle cx="352" cy="33.3" r="4" class="fig-s1"/> <circle cx="480" cy="28.0" r="4" class="fig-s1"/> <text x="96" y="145" text-anchor="middle" class="fig-num">49.24</text> <text x="224" y="94" text-anchor="middle" class="fig-num">74.86</text> <text x="352" y="23" text-anchor="middle" class="fig-num">97.33</text> <text x="480" y="19" text-anchor="middle" class="fig-num">100.00</text> <path d="M96 61.9L224 40.3L352 40.2L480 39.2" class="fig-edge"/> <rect x="92" y="57.9" width="8" height="8" rx="1" class="fig-s2"/> <rect x="220" y="36.3" width="8" height="8" rx="1" class="fig-s2"/> <rect x="348" y="36.2" width="8" height="8" rx="1" class="fig-s2"/> <rect x="476" y="35.2" width="8" height="8" rx="1" class="fig-s2"/> <text x="96" y="52" text-anchor="middle" class="fig-num">83.07</text> <text x="224" y="31" text-anchor="middle" class="fig-num">93.87</text> <text x="352" y="54" text-anchor="middle" class="fig-num">93.93</text> <text x="510" y="43" text-anchor="start" class="fig-num">94.40</text> <path d="M96 88.9L224 68.7L352 68.5L480 57.2" class="fig-edge"/> <circle cx="96" cy="88.9" r="4" class="fig-s3"/> <circle cx="224" cy="68.7" r="4" class="fig-s3"/> <circle cx="352" cy="68.5" r="4" class="fig-s3"/> <circle cx="480" cy="57.2" r="4" class="fig-s3"/> <text x="96" y="104" text-anchor="middle" class="fig-num">69.54</text> <text x="224" y="61" text-anchor="middle" class="fig-num">79.67</text> <text x="352" y="83" text-anchor="middle" class="fig-num">79.74</text> <text x="480" y="73" text-anchor="middle" class="fig-num">85.42</text> <circle cx="74" cy="210" r="4" class="fig-s1"/> <text x="84" y="214" class="fig-label">Engineering Portfolio</text> <rect x="236" y="206" width="8" height="8" rx="1" class="fig-s2"/> <text x="250" y="214" class="fig-label">Coverage Review</text> <circle cx="380" cy="210" r="4" class="fig-s3"/> <text x="390" y="214" class="fig-label">Court Clerk Ops</text> </svg> <ol class="fig-steps"> <li>Engineering Portfolio Analytics: Zero-shot 49.24, Initial Skill 74.86, Iteration 1 97.33, Iteration 2 100.00</li> <li>Coverage Review: Zero-shot 83.07, Initial Skill 93.87, Iteration 1 93.93, Iteration 2 94.40</li> <li>Court Clerk Operations: Zero-shot 69.54, Initial Skill 79.67, Iteration 1 79.74, Iteration 2 85.42</li> </ol> <figcaption>Five-task training mean progression inside the continuous training container across three sub-benchmarks: from zero-shot attempt to initial skill distillation, followed by two iterations of improvement.</figcaption> </figure>

| Benchmark | Zero-shot | Initial Skill | Iteration 1 | Iteration 2 | Final Retained |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Engineering Portfolio Analytics | 49.24 | 74.86 | 97.33 (Accepted) | 100.00 (Accepted) | 100.00 |
| Coverage Review | 83.07 | 93.87 | 93.93 (Accepted) | 94.40 (Accepted) | 94.40 |
| Court Clerk Operations | 69.54 | 79.67 | 79.74 (Accepted) | 85.42 (Accepted) | 85.42 |

Across the Engineering Portfolio Analytics, Coverage Review, and Court Clerk Operations Benchmarks, the Agent starts from zero-shot scores of 49.24, 83.07, and 69.54, achieves a clear jump after distilling the initial `SKILL.md`, and further improves over two iterations to reach final training means of 100.00, 94.40, and 85.42.

Alongside SkillAdam, we evaluated three additional representative self-evolution methods under the same protocol:

| Method | Paper | Plugin ID | In-Container Learning and Selection Mechanism |
| :--- | :--- | :--- | :--- |
| SkillAdam | [arXiv:2609.08944](https://arxiv.org/abs/2609.08944v1) | `skilladam-rsi-toolkit` | Refines skills with an Evolving Issue Tracker and variance-adaptive edit budgets, exporting the last accepted version that strictly improves the 5-task training mean |
| SkillOpt | [arXiv:2605.23904](https://arxiv.org/abs/2605.23904v1) | `skillopt-rsi-toolkit` | Reflects on trajectories in minibatches, merges localized edit proposals under a cosine-annealed budget, and exports the highest-scoring accepted version |
| TRACE | [arXiv:2608.22793](https://arxiv.org/abs/2608.22793v2) | `trace-rsi-toolkit` | Coordinates Actor and Curator roles to distill a modular skill bank from execution traces, selecting the checkpoint with the highest full-batch training mean |
| OpenSkill | [arXiv:2606.06741](https://arxiv.org/abs/2606.06741v1) | `openskill-rsi-toolkit` | Operates without the online training judge by researching domain rules and constructing independent virtual tests to iteratively repair the skill |

## 3. Launching the Experiment in the PenguinHarness Web UI

Running a GDPEVO Essential self-evolution experiment in PenguinHarness requires no custom orchestration scripts. You can launch an experiment in four steps through the Web UI.

### Step 1: Configure the Model API Key

Open the Models page from the left sidebar, find the model used for the experiment, DeepSeek V4.1 Flash, enter its API key, and save.

> **TODO (Screenshot Placeholder — Configuring Model API Key)**: Insert screenshot of configuring the DeepSeek V4.1 Flash API key on the Models page.

### Step 2: Create a Controller Agent and Install the RSI Toolkit

Open the Agents page from the left sidebar, click Create manually in the top-right corner, set the agent name to GDPEVO Controller, and set the Agent id to gdpevo_controller. In the Plugins dropdown below, search for skill and select skilladam-rsi-toolkit—or select skillopt-rsi-toolkit, trace-rsi-toolkit, and openskill-rsi-toolkit as well if you plan to compare multiple methods—then click Create.

<img src="/blog-screenshots/gdpevo-create-agent.webp" width="2160" height="1760" alt="Filling in GDPEVO Controller and selecting self-evolution toolkit plugins in the Create agent dialog" />

### Step 3: Open the Chat View and Select the Model

Once GDPEVO Controller is created, click New chat on its card in the Agents list to open its conversation view, then select DeepSeek V4.1 Flash in the model picker below the input box and set the thinking effort to max.

<img src="/blog-screenshots/gdpevo-configure-model.webp" width="1676" height="830" alt="Selecting DeepSeek V4.1 Flash and max thinking effort in the GDPEVO Controller chat view" />

### Step 4: Attach the Toolkit and Send the Launch Prompt

Because single-container continuous training, freezing the exported SKILL.md, and running 3 test repetitions are already built into the toolkit and Benchmark definitions, the launch prompt does not need to repeat the procedural rules. Attach skilladam-rsi-toolkit in the chat input and specify the toolkit name, target Benchmark, model, thinking level, and Docker concurrency limit.

To evaluate a single sub-benchmark such as service-ticket-resolution, send:

> Use skilladam-rsi-toolkit to run a self-evolution experiment on the service-ticket-resolution Benchmark of GDPEVO Essential. Use model DeepSeek V4.1 Flash, thinking level max, and Docker concurrency limit 4.

To evaluate all six sub-benchmarks in the GDPEVO Essential series, send:

> Use skilladam-rsi-toolkit to run a self-evolution experiment across all six Benchmarks of the GDPEVO Essential series. Use model DeepSeek V4.1 Flash, thinking level max, and Docker concurrency limit 4.

To evaluate another self-evolution algorithm, replace the attached toolkit and skilladam-rsi-toolkit in the prompt with skillopt-rsi-toolkit, trace-rsi-toolkit, or openskill-rsi-toolkit.

> **TODO (Screenshot Placeholder — Attaching the Toolkit & Sending the Launch Prompt)**: Insert screenshot showing skilladam-rsi-toolkit attached in the chat composer with the launch prompt above.

## 4. Internal Execution Pipeline After Launch

Once the launch prompt is sent in the Web UI, the Controller Agent automatically runs training and testing in the background through four stages:

<figure class="post-figure" data-widget="gdpevo-orchestration"><ol class="fig-steps"><li>Multi-Round Train: Controller Agent launches 1 Shared Docker via Harbor, where Target Agent evolves SKILL.md across T1–T5</li><li>Evolved Agent: freezes and exports SKILL.md as a read-only artifact mounted onto Evolved Agent</li><li>Isolated Testing: Controller Agent dispatches 1-to-5 fan-out via Harbor into Isolated Dockers across Test 1–5 for 3 repetitions (15 fresh containers)</li><li>Scoreboard: 5-to-1 convergence into Offline Verifier to grade per-task and overall mean scores</li></ol><figcaption>Four-stage execution pipeline driven by the Controller Agent.</figcaption></figure>

### 1. Multi-Round Training Loop

After preparing the task checkout, the Controller Agent preserves a clean initial state without any domain skill as the frozen Baseline reference, and uses Harbor to launch one shared training container for the Benchmark. Docker provides full environment isolation for the Benchmark: the business backend service, task payloads, and online judge run inside the container while external network access is restricted to loopback business calls and the model API. Within one persistent session inside the shared container, the Target Agent cycles through all 5 training tasks across multiple rounds, diagnosing errors and iteratively updating its skill document.

### 2. Producing the Evolved Agent

Once the multi-round training loop finishes, the Controller Agent exports the last accepted `SKILL.md`, locks its write permissions, and mounts it read-only onto the clean base state to form the frozen Evolved Agent.

### 3. Multi-Run Isolated Testing

The Controller Agent uses Harbor to run the frozen Evolved Agent and the Baseline state across the Benchmark's 5 held-out test tasks for 3 full repetitions. Every question in every repetition starts in a brand-new Docker container and clean session—no filesystem state, database state, or conversation history is shared across questions or runs, and the online training judge is disabled.

### 4. Offline Scoring

As test containers finish, outputs from the 5 test tasks are graded by the Offline Verifier on a 100-point scale and aggregated into the final mean score and standard deviation.

## 5. Metric Aggregation and Empirical Results

Scores and resource costs are aggregated at two levels:

- **Per-Benchmark Test Score**: Let <i>s<sub>r,q</sub></i> be the score on test question <i>q</i> ∈ {1..5} in repetition <i>r</i> ∈ {1, 2, 3}. We first compute the 5-question mean within each repetition, <i>s̄<sub>r</sub></i> = (1/5) ∑<sub><i>q</i>=1..5</sub> <i>s<sub>r,q</sub></i>, and then compute the mean <i>μ</i> = (1/3) ∑<sub><i>r</i>=1..3</sub> <i>s̄<sub>r</sub></i> and sample standard deviation <i>s</i> = √((1/2) ∑<sub><i>r</i>=1..3</sub> (<i>s̄<sub>r</sub></i> − <i>μ</i>)<sup>2</sup>) across the 3 repetitions.
- **Series-Wide Overall Score**: Within each repetition <i>r</i>, we average the 6 sub-benchmark means with equal weight, <i>S̄<sub>r</sub></i> = (1/6) ∑<sub><i>d</i>=1..6</sub> <i>s̄<sub>r,d</sub></i>, and then compute the mean and sample standard deviation across the 3 repetitions.
- **Cost and Elapsed Time**: Training runs once per Benchmark, so training cost and time sum the single training runs across all 6 sub-benchmarks. Testing runs for 3 full repetitions, and the table reports the average cost and time per full test repetition across the series (30 test questions, i.e., total across 3 repetitions divided by 3). All costs are calculated under the unified MMSP pricing catalog.

Overall results across the six Benchmarks in the GDPEVO Essential series comparing the four self-evolution methods against the unified Baseline are shown below:

| Method | Overall Test Score (Mean ± SD) | Lift vs. Baseline | Total Train Cost | Total Train Time | Avg Test Cost / Run | Avg Test Time / Run |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 56.32 ± 2.17 | — | — | — | $2.51 | 5h 20m |
| SkillOpt | 70.25 ± 0.03 | +13.93 | $3.89 | 4h 53m | $1.95 | 4h 30m |
| SkillAdam | 68.95 ± 0.74 | +12.63 | $5.45 | 4h 19m | $2.06 | 3h 44m |
| TRACE | 68.02 ± 1.80 | +11.69 | $5.29 | 3h 26m | $1.67 | 3h 37m |
| OpenSkill | 62.16 ± 2.31 | +5.83 | $5.56 | 8h 15m | $2.63 | 4h 45m |

Per-benchmark test scores (Mean ± SD) across the six sub-benchmarks are as follows:

| Benchmark | Baseline | SkillAdam | SkillOpt | TRACE | OpenSkill |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Service Ticket Resolution | 48.90 ± 10.06 | 65.78 ± 0.00 (+16.88) | 69.95 ± 6.30 (+21.05) | 59.38 ± 3.85 (+10.49) | 61.46 ± 0.28 (+12.57) |
| Financial Control | 50.97 ± 1.08 | 63.89 ± 4.42 (+12.93) | 58.03 ± 7.14 (+7.07) | 62.56 ± 1.55 (+11.59) | 52.45 ± 9.15 (+1.48) |
| Portfolio Management | 70.16 ± 2.10 | 74.25 ± 1.28 (+4.09) | 77.40 ± 3.18 (+7.24) | 74.55 ± 8.71 (+4.39) | 74.27 ± 4.90 (+4.11) |
| Coverage Review | 55.00 ± 0.00 | 80.67 ± 0.58 (+25.67) | 71.00 ± 0.00 (+16.00) | 68.67 ± 0.58 (+13.67) | 73.67 ± 2.52 (+18.67) |
| Court Clerk Operations | 52.60 ± 1.68 | 55.37 ± 2.32 (+2.77) | 61.98 ± 1.41 (+9.39) | 51.43 ± 1.69 (−1.17) | 50.55 ± 2.65 (−2.04) |
| Engineering Portfolio Analytics | 60.32 ± 5.11 | 73.74 ± 0.00 (+13.42) | 83.15 ± 0.00 (+22.83) | 91.52 ± 1.57 (+31.19) | 60.55 ± 3.08 (+0.23) |

## 6. Key Insights and Discussion (Placeholder)

> **TODO (Insights Placeholder)**: This section is reserved for follow-up insights and deeper takeaways from the GDPEVO Essential benchmark series experiments (e.g., skill distillation characteristics across different sub-benchmarks, trade-offs between supervised online judge feedback and unsupervised virtual testing, and how evolved skills reduce test-time reasoning turns and cost).
