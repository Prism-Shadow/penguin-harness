---
name: penguin-harness-qa
description: Use when running a QA round on PenguinHarness — given a ref and a budget, choosing which tasks under tests/scenarios to run, writing the plan a person confirms, running the tasks in order from a clean or handed-over environment, and delivering the reports and the round's overview. Covers the plan's inputs and output, the rules for recommending a subset within a budget, when to stop a task, and what the round delivers.
---

# Running a QA round

A round takes the tasks in `tests/scenarios/` and runs some of them against one ref. It has three
parts, always in this order: **plan**, which a person confirms; **run**; **deliver**. The task
format — frontmatter, sections, per-task output, `handover.md` — is defined in
`tests/scenarios/README.md`; read it first. This skill does not repeat it.

QA measures usability, not the Agent running it. Spend effort on judging what the product shows;
let scripts do the mechanical operation.

## 1. Plan

### Inputs of the round

Ask the person starting the round for these; do not guess any of them.

| Input | What it is |
| --- | --- |
| ref | The release tag, tag or revision under test. |
| budget | Minutes available for the whole round. |
| surface | Where the tasks run: a disposable directory on a test machine, a CI runner, or a disposable VM or container. |
| platforms | The platforms this round covers. |
| focus | Optional: areas to look at first (for example "sandbox, themes"). |
| previous run | Optional: the `<RUN>` directory of an earlier round. |
| tracker | Where product problems are reported. |
| `<RUN>` | The output directory, outside the repository. |

### What to read

- The frontmatter of every `tests/scenarios/*/*/TASK.md`: `starts_from`, `inputs`, `cost`,
  `platforms`.
- The changelog between the previous run's ref and this ref; without a previous run, this ref's
  own changelog (a release's body, or `changelog/unreleased/` at the revision).
- The previous run's `issues.md` files, for problems that may still be open.

### Recommending a subset

1. Drop tasks whose `platforms` or needs do not fit the round's platforms and surface. A task
   that must run in a disposable VM or container is dropped on any other surface.
2. Rank the rest: tasks the focus names first, then tasks whose area the changelog touches, then
   tasks with problems left open by the previous run, then the rest.
3. Take tasks in that order. With each, take the tasks on its `starts_from` chain that are not
   chosen yet, and count their cost too. Skip a task whose cost, with its chain, no longer fits
   the budget, and go on to the next.
4. Give every task, chosen or not, one line of reason.
5. When a task the focus names does not fit, say how many more minutes it needs, and leave the
   choice between more budget and a different task to the person.

### Preparing inputs

Fix every input in the frontmatter of every chosen task. For a task with a `## Prepare` section,
produce that input now, at the path the task names under `<RUN>`.

### The plan

Write `<RUN>/plan.md`:

- ref, budget, surface, platforms, focus, tracker;
- the chosen tasks in run order (every task after the one its `starts_from` names), with their
  reasons and costs, and the total;
- the tasks left out, with their reasons;
- every input of every chosen task, or the path of the prepared input.

Give the plan to the person who started the round. **Do not start the run until they confirm
it.** A change they ask for goes into `plan.md` before the run starts.

## 2. Run

- Run the tasks in the plan's order. Before each, read the `handover.md` of the task its
  `starts_from` names.
- Use the scripts in a task's `scripts/` for the steps that name them; the verdict on their
  output is yours.
- Keep time. When a task has used twice its `cost` and is not done, stop it at the current step,
  write in its report which step and why, and go on to the next task.
- When a task fails in a way that leaves no usable environment, mark every task that starts from
  it "not run (prerequisite failed)". Never run a task on a half-built environment.
- When the round's budget is used up, mark every task not yet started "not run (budget)".
- Do not add tasks or change inputs during the run. Anything the plan missed goes into the
  reports as a finding.

## 3. Deliver

- Each task's output, as `tests/scenarios/README.md` defines it, under `<RUN>/<group>/<task>/`.
- `<RUN>/index.html`, one self-contained file (styles inline, no external references): the ref,
  surface and platforms; one row per planned task with its status (done, stopped, not run and
  why) and a link to its report; the product problems of every task in one list, each linking to
  its entry in the task's `issues.md`.
- When the round covers more than one platform, add a section to `index.html` comparing them:
  for each task run on several platforms, where the verdicts differ.
- Report product problems to the plan's tracker and add the reference to the `issues.md` entry.
  Environment problems stay in the reports.
- Clean up: stop every process the round started, and delete the round's scratch directories —
  only those. `<RUN>` stays.
