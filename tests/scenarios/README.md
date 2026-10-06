# QA scenarios

Each directory `tests/scenarios/<group>/<task>/` holds one QA task. Its `TASK.md` is the prompt a QA
Agent is given: what to do, what to record, and when the task is done. These are not automated
tests. They check a built product the way its users meet it, run by an Agent against a real
install, with screenshots and log lines as evidence.

QA measures usability: whether a person can install the product, find their way, and get what the
release promises. It does not measure how capable the Agent running the task is. Where a step is
mechanical, a script does it (see [Scripts](#scripts)), and the Agent spends its effort on judging
what the product showed.

## Tasks

| Task                                                         | Starts from        | Cost (min) | What it answers                                               |
| ------------------------------------------------------------ | ------------------ | ---------- | ------------------------------------------------------------- |
| [`install/from-ref`](install/from-ref/TASK.md)               | `scratch`          | 30         | Does the given release, tag or revision install from nothing? |
| [`usability/use-ui`](usability/use-ui/TASK.md)               | `install/from-ref` | 45         | Can a new user find their way through the Web App?            |
| [`usability/use-cli`](usability/use-cli/TASK.md)             | `install/from-ref` | 30         | Can a new user get work done from the terminal?               |
| [`usability/changed-feature`](usability/changed-feature/TASK.md) | `install/from-ref` | 60         | Is every change the changelog promises really there?          |

A group names one question about the product (can it be installed, is it usable), not a part of
it: a group named after a surface such as "ui" would end up holding every task. The surfaces and
the release's changes are tasks inside `usability`.

A run need not take every task. Pick the ones the budget allows; a task whose `starts_from` names
another task needs that task's end state (see [Handover](#handover)).

## `TASK.md` format

Frontmatter:

```yaml
---
title: One sentence naming the task
starts_from: scratch # or <group>/<task>: continue from where that task left the environment
inputs: # every value the task needs, all fixed in the run's plan before the run starts
  ref: what it is
cost: 30 # estimated minutes, used to choose tasks within a budget
platforms: [linux, macos, windows]
---
```

Body, in this order:

- `## Goal` — what the task establishes, in two or three sentences.
- `## Prepare` — only for a task with an input that takes work to produce (such as the list of
  changelog entries and how to check each). It says how to produce that input before the run, and
  what it must contain.
- `## Steps` — numbered steps. Each gives the command or the clicks, what to observe, the
  screenshot to take, and the counter-example: what this step looks like when it has found a
  problem.
- `## Record` — the files the task writes into its output directory.
- `## Done when` — the conditions that end the task.
- `## Never` — what the task must not do.

Platform differences go inside the step that differs, not into a second copy of the task.

## Plan

Every input is decided before the run starts, never while it runs. The person who starts a run
names an output directory `<RUN>` outside this repository and writes `<RUN>/plan.md`: the tasks
chosen, and for each the value of every input in its frontmatter. An input with a `## Prepare`
section is produced then, written to the path the task names under `<RUN>`, and reviewed with the
rest of the plan. A task does not start while one of its inputs is missing from the plan.

How to choose the tasks within a budget, and the whole round from plan to delivery, is the
[`penguin-harness-qa`](../../.agents/skills/penguin-harness-qa/SKILL.md) skill.

## Scripts

A task may carry scripts next to its `TASK.md`, in `scripts/`, for steps that are pure operation:
driving the browser along a fixed path with Playwright, taking the screenshots, collecting logs.
Use one whenever the step checks something other than the Agent itself (the installer, the
sandbox, a settings page), so that every run operates the product the same way. The step then
says which script to run and what to judge in its output; the verdict stays with the Agent.

## Output

Results are never committed. Each task writes to `<RUN>/<group>/<task>/`:

- `report.html` — one self-contained file: styles inline, no external references in the body,
  screenshots and evidence linked by relative path. Every screenshot has a caption naming its step
  and the verdict for that step.
- `shots/` — one PNG per observation, named `<step>-<nn>-<what>.png` (for example
  `s05-01-cli-help.png`).
- `evidence/` — verbatim sources: installer output, server log excerpts, the changelog text as
  published.
- `issues.md` — one entry per problem: what was seen, how to reproduce it, the evidence (a
  screenshot or a quoted log line), and the cause if it is known. Mark each entry `product` or
  `environment`; only product problems are reported further.
- `oplog.md` — for tasks that operate the UI, the operation log: one line per action, with the
  time, what was clicked or typed, and what the screen showed.

## Handover

A task that leaves an environment behind writes `<RUN>/<group>/<task>/handover.md`: the install
directory, the `HOME` it ran under, the data root, the server URL and how to sign in, and the
processes still running. A task with `starts_from: <group>/<task>` reads that file first. When it
is missing, either run that task first, or reuse an environment a previous run left for the same
ref and say in the report where it came from.

## Verdicts

Write only what was seen. Each observation is "present" or "absent", or a quoted line; never "looks
fine". A check that could not be made says so and why (for example: the feature is Windows-only,
or it needs a plugin the default install does not have). Keep product problems apart from
problems of the test environment.
