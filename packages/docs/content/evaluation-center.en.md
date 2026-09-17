---
title: Evaluation Center
description: Create Benchmarks, score agents on them, and improve agents against those scores in the Web App.
---

The Evaluation Center is where you measure and improve agents in the Web App. A **Benchmark** is a set of cases, each with a task statement and a private scoring rubric. A Benchmark belongs to the Project rather than to one agent, so it can score any agent in the Project.

- To build a Benchmark, see [Create a Benchmark with AI](#create-a-benchmark-with-ai) or [Create a Benchmark manually](#create-a-benchmark-manually).
- To read the cases, the score chart and past evaluations, see [Read a Benchmark](#read-a-benchmark).
- To score an agent, see [Evaluate an agent](#evaluate-an-agent).
- To improve an agent against its scores, see [Optimize an agent](#optimize-an-agent).
- To change the questions or clean up, see [Replace a Benchmark](#replace-a-benchmark) and [Delete a Benchmark](#delete-a-benchmark).

For how evaluation and optimization work behind these pages, see [Self-Improvement](/self-improvement).

## Open the Evaluation Center

In the sidebar, select **Evaluation Center**. The page (`/benchmark`) lists every Benchmark of the current Project as a card.

Under the title, three numbered step cards outline the loop: **Create**, **Evaluate** and **Optimize**. Each says where to do that step: with the create buttons at the top right, or with **Use** on a Benchmark followed by the matching tab. The owner gets two create buttons, **Create with AI** and **Create manually**; a member gets **Create with AI** alone, and the first card names only that.

Each Benchmark card shows:

- the title, the directory name and the description;
- the number of cases and the runs per case;
- when the Benchmark was last evaluated, and the agents it has tested;
- a sparkline of its scores, and the newest score with its change from the previous evaluation under the same [label](#score-chart).

A card's actions are **Use**, **View** and, for the Project owner, a delete icon. Selecting the card itself does the same as **View**.

To narrow the list, type in the search box; it matches titles, descriptions and tested agents. The address `/benchmark?agentId=<agent>` lists only the Benchmarks that have evaluated that agent; select **Show all** to see every Benchmark again.

### Benchmarks that are not ready

A Benchmark that is not finished is masked. Its card is dimmed under a notice, **Use** and **View** are disabled, and its page shows the same notice in place of the cases and the chart. Only the owner's delete icon still works.

- **Being built**: AI is still writing the cases and calibrating their difficulty. The Benchmark opens once that is done.
- **Creation failed**: the difficulty calibration never finished. The owner deletes the Benchmark and creates it again; a member is only told that calibration did not finish, because deleting is the owner's to do.

### The example Benchmark

Every Project comes with `example-benchmark`, whose sample evaluations test `default_agent`, so the page has data from the start. If you delete it, it comes back the next time `default_agent` loads.

## Create a Benchmark with AI

AI writes the cases for an agent, trial-runs each case to calibrate its difficulty, and records the agent's first score, the baseline.

1. At the top right of the Evaluation Center, select **Create with AI**.
2. In the **Create a Benchmark with AI** dialog, choose a **Test Agent**: the agent the cases are written for. Its scores are recorded under it.
3. Describe the capability and the scenarios to test, or start from one of the examples under **Try an example**.
4. Select **Edit in a new conversation**. The prompt opens in a new conversation's composer, with the `benchmark-design` and `agent-evaluation` Skills selected.
5. Review the prompt and send it. Nothing runs until you do.

The dialog's "Done by … in a new conversation" line names the agent that does the writing: the Project's default agent, not the Test Agent.

The Builder runs the Test Agent on the model of this new conversation, for the trial runs and for the baseline. Evaluations started later from the **Evaluate** tab run the agent on the model it is configured with, and the chart gives each model its own line. To keep the baseline on the same line as later scores, pick the Test Agent's configured model in the composer before you send.

While the cases are being written, the Benchmark's card shows **Being built**. The Benchmark opens once the baseline is recorded. If calibration fails, the card shows **Creation failed**; the owner then deletes the Benchmark and creates it again.

## Create a Benchmark manually

**Before you begin**

- Only the Project owner can create a Benchmark manually.

1. At the top right of the Evaluation Center, select **Create manually**.
2. In the **Create a Benchmark manually** form, fill in **Title**, **Benchmark id** and **Description**. The id is also the directory name: letters, digits, `_` and `-` only. It does not follow the title as you type; select **Generate with AI** beside the field to derive a kebab-case id from the title.
3. Set **Runs per case**, an integer from 1 to 1000. Evaluations and optimizations run every case this many times by default and average the results.
4. For each case, fill in **Directory suffix**, **Case title**, **Statement** and **Scoring rubric**. The statement goes to the agent under test. The rubric lists observable scoring items that total 100 points, and never reaches the agent under test. Select **Add case** to add another case.
5. Select **Create Benchmark**. The Benchmark's page opens.

You do not choose an owning agent. A manual Benchmark is published at once but has no baseline yet, so [evaluate an agent](#evaluate-an-agent) on it before you optimize.

## Read a Benchmark

Select a Benchmark card, or **View**, to open the Benchmark's page (`/benchmark/<benchmark>`). **Back to list** returns to the list.

The header shows the Benchmark's directory, `benchmarks/<benchmark>`, beside the title, with a **Copy directory path** button, and its own **Use** button.

### Cases

**Cases** lists the Benchmark's cases. Select **View details** on a case to open it.

The case dialog shows the case's files in the same file browser as the plugin details: a file tree on the left, listed level by level, and a read-only preview on the right. The tree has two top-level folders:

- **Task materials**: what the agent under test works from.
- **Scoring rubric**: what the evaluator scores against. This folder is marked **Hidden from Target Agent**.

### Score chart

The **Score over time** chart plots each evaluation's score over time, with one line per **label**. A label combines the tested agent, the model ID and the thinking level, so only comparable scores share a line. A record without a label falls into a grey **Unlabeled** series.

The Agent State version is deliberately left out of the label. Successive versions of one agent on the same model and thinking level stay on one line, which is where an improvement becomes visible. Hover over a point to see the version it tested.

### Evaluations

The **Evaluations** table lists the Benchmark's evaluations, newest first. Its columns are **Time**, **Tested agent**, **Version**, **Model ID**, **Thinking level**, **Score**, **Cost** and **Duration**. A Benchmark with no evaluations shows **No evaluations yet** instead.

Select a row to open that evaluation in a dialog. The dialog shows:

- the label, with the tested agent and its version;
- the score, cost and duration;
- the evaluation's summary, with its title and body shown separately;
- a per-case table whose rows expand to every run's raw result and the Session it ran in.

Select a case in that table to open the case dialog on top.

## Ask AI about a case or an evaluation

The case dialog and the evaluation dialog both end with **Ask AI**. It opens a prompt dialog with a question already filled in, and example questions you can switch to. The default question is also the first example, so you can bring it back after trying another.

In the case dialog, the examples are:

- **Explain what this case tests and what a strong answer looks like** (the default)
- **What does the rubric reward?**
- **Why did a run score low here?**
- **How could the statement be clearer?**

In the evaluation dialog, the examples are:

- **Explain this evaluation's result** (the default)
- **Why is the score low?**
- **Which cases are weakest, and what should change?**
- **What changed against the previous evaluation?**

A fixed ending passes along the facts on screen:

- For a case: the paths of its `statement/README.md` and `rubric/README.md`, and how the latest evaluation's runs scored it.
- For an evaluation: the Benchmark id and directory, the time, the label, the version, the evaluation runtime, the total and per-case scores, every run's Session id, and the summary.

The agent is asked to read those files and Traces and explain what it finds. It only reads and analyzes, and changes neither the Benchmark nor the tested agent. Select **Edit in a new conversation**, then send the prompt.

## Evaluate an agent

An evaluation runs an agent on every case of a Benchmark and adds one labelled score to the Benchmark's scoreboard.

1. On a Benchmark card, or in a Benchmark page's header, select **Use**. The dialog opens on the **Evaluate** tab.
2. In **Tested agent**, choose the agent to evaluate. It defaults to the agent of the newest evaluation.
3. In **Evaluator agent**, choose the agent that runs and scores the evaluation. It needs the `agent-evaluation` Skill, and the dialog warns you when that Skill is missing.
4. Optional: change **Model of the evaluation conversation** (preset to the Project's default model) or **Runs per case** (preset to the Benchmark's configured count), and add a **Note**.
5. Select **Edit in a new conversation**, review the prompt, and send it.

The dialog has no field for the model or thinking level the tested agent runs on. **Model of the evaluation conversation** only sets the model of the conversation that dispatches and totals the runs.

The evaluation conversation, and every Test Session it starts, is filed under the **Evaluations** folder of the session list. The finished evaluation becomes the newest row of the Benchmark's **Evaluations** table.

## Optimize an agent

Optimization changes an agent one hypothesis at a time and keeps a new version only when its score strictly improves. It measures against the agent's baseline on this Benchmark.

**Before you begin**

- The agent has a complete evaluation on this Benchmark. A Benchmark created with AI has one for its Test Agent; otherwise, [evaluate the agent](#evaluate-an-agent) first.

1. On a Benchmark card, or in a Benchmark page's header, select **Use**, then the **Optimize** tab.
2. In **Tested agent**, choose the agent to improve. The tab shows its current baseline and the target.
3. In **Optimizer agent**, choose the agent that does the work. It needs the `agent-optimization` Skill, and the dialog warns you when that Skill is missing.
4. Set **Runs per case**, **Round limit** (3 by default) and **Target score**. The target defaults to the baseline rounded up plus 10, at most 100.
5. Optional: change **Model of the optimizer's conversation** (preset to the Project's default model), and describe a **Focus**.
6. Select **Edit in a new conversation**, review the prompt, and send it.

The optimizer stops early when it reaches the target score, and otherwise after the round limit. Its evaluations keep the model and thinking level the baseline recorded. Each accepted version appears as a new point on the same chart line, and its version shows in the **Version** column and in the point's hover text.

> [!WARNING]
> When the tested agent has no baseline on this Benchmark, the tab warns you to take one on the **Evaluate** tab first, and the target defaults to 80. Sending is not blocked, but the `agent-optimization` Skill stops and explains that it needs a baseline.

## Replace a Benchmark

A Benchmark's cases are frozen once it exists. Neither the Web App nor the server API can edit a statement or a rubric: changing the questions would make the scores already on the scoreboard incomparable. The calibration AI does while writing the cases happens before the baseline is taken, as part of creating them.

To ask different questions, create a new Benchmark and delete the old one:

1. Open a case, select **Ask AI**, choose **How could the statement be clearer?**, and send the conversation.
2. Select **Create with AI**, and describe the old Benchmark together with the suggested changes.
3. Once the new Benchmark is published, [delete the old one](#delete-a-benchmark).

## Delete a Benchmark

Only the Project owner can delete a Benchmark, and only from its card in the list, not from the Benchmark's page.

1. On the Benchmark's card, select the delete icon (**Delete Benchmark**).
2. Read the confirmation: every case and evaluation record will be removed, and this cannot be undone.
3. Select **Delete**.

> [!NOTE]
> Deleting `example-benchmark` does not last: it is written again the next time `default_agent` loads.

## How it works

- **Storage.** A Benchmark is the directory `benchmarks/<benchmark>/` in the Project, beside `agents/`, named by its Benchmark id. Each case has `statement/README.md` and `rubric/README.md`, and the scores are in `scoreboard.yaml`. See [Benchmark storage](/self-improvement#benchmark-storage).
- **Status.** `status` in `benchmark_config.toml` drives the mask: `draft` shows **Being built**, `failed` shows **Creation failed**, and `published` lifts the mask.
- **Creating with AI.** The prompt's fixed ending hands the `benchmark-design` Skill the Test Agent's id, a desired baseline score and a pilot-iteration limit, and asks for the baseline to be taken.
- **Creating manually.** The server writes the form to disk in the layout the Skills read (`POST …/benchmarks`, owner only), with the status `published`.
- **Evaluating.** The prompt asks for the full Case × runs matrix through self-spawned `agent-evaluation` subagents. Every result must report the same agent, model and thinking level, and exactly one labelled evaluation is appended to `scoreboard.yaml`. The tested agent and the Benchmark are left untouched.
- **Deleting.** The server removes the directory whole (`DELETE …/benchmarks/:id`). Deleting a Benchmark while an evaluation is still running can leave a directory behind, because the evaluation keeps writing into it. That directory has no `benchmark_config.toml`, so it is not listed, and you can delete it by hand.
- **The example Benchmark.** `example-benchmark` is written whenever `benchmarks/example-benchmark/` is missing and `default_agent` loads.
