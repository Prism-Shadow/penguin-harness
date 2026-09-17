---
name: company-research
description: Run experiments and papers in a PenguinHarness research organization — fix the harness and the metric first, run an autoresearch-style loop (one editable surface, the same time budget per experiment, a results log, keep only improvements) inside a resource envelope the board approved in the all-hands channel, and put every claim through adversarial review by a reviewer who is not its author.
---

# Company Research

A research organization produces claims — a number on a metric, a method that beats a baseline, a paper — and a claim is worth exactly what survives an attempt to break it. This skill is what the researchers and the reviewers of such an organization add to `company-employee`: an experiment loop shaped after autoresearch, a resource envelope the board approves before the loop starts, and a review that is adversarial by design because the reviewer is never the author. The CEO's checklist in `company-ceo` still applies; this skill says what the tickets of a research stream look like inside it.

## Before you start

If the message only names this skill (e.g. "use company-research skill") without a concrete request, ask what is wanted — an experiment loop to set up, a run to continue, a claim to review, a review to answer. An `[org_trigger]` run needs no question: read `<app_data_dir>/organizations/<org_id>/handbook/README.md` and act on what the block says.

## When this applies

The mission asks for research: experiments to run, results to claim, papers to write. Two roles use this skill:

- **Authors** — the researchers and engineers who own experiment and paper tickets, run the loop and write the claims;
- **Reviewers** — employees the CEO hires for reviewing alone. **A reviewer authors nothing it reviews, and an author never reviews its own claim.** The CEO of a research organization hires at least one dedicated reviewer in its first plan, and a reviewer's brief names the streams it reviews.

Both are ordinary employees: the desk schedules, ticket sessions do the work, the handbook comes first. A researcher's or reviewer's brief (`agent_state/AGENTS.md`) names `company-research` beside `company-employee`.

## The resource envelope comes first

An experiment loop is the textbook case of what `company-employee` calls heavy or long compute, so it never starts on your own decision. Before the first experiment of a ticket, ask the board — the organization's creator, `@user:<id>` from `created_by` in `org_config.toml` — in the **all-hands channel** for the envelope, in one message:

- **machine**: which host, GPU or CPU it runs on, and how much memory;
- **concurrency**: how many experiments at once;
- **total**: hours of wall-clock, or a number of experiments, after which the loop stops by itself;
- **disk and data**: how much space, which datasets, what may be downloaded and where to;
- **money and keys**: any paid API or credential the loop needs and does not have;
- the **estimated load** while it runs, and **how to stop it** — the loop runs inside a ticket session, so stopping that session stops it.

Then block the ticket on the board and end the run, exactly as "Asking the board" in `company-employee` says:

```bash
penguin org channel send -m "@user:alice 2026-09-01-dep-eval is ready for its experiment loop: 5-minute runs on GPU 0 (about 10 GB of VRAM), one at a time, 40 runs or 4 h in total, 6 GB of disk under <app_data_dir>/organizations/co_lab/workspace/experiments/dep-eval/; the dataset is already in the shared root and no paid API is involved. It runs inside the ticket session — stop that session and the loop stops. May I start? Otherwise I stop at 10 runs." --ref-ticket 2026-09-01-dep-eval
penguin org ticket block 2026-09-01-dep-eval --reason "Waiting for the board's resource envelope for the experiment loop" --by user:alice
```

Once approved, write the envelope into the ticket's `## Goal` (machine, concurrency, total, disk, keys — the numbers as approved) and into the handbook as `decisions/<yyyy-mm-dd>-envelope-<ticket_id>.md`, so the next session reads it instead of asking again. **Inside the envelope the loop runs unattended.** Reaching its total ends the loop; exceeding it — more hours, a second GPU, more runs — or needing something new — a dataset that is not there, an API key, a bigger model — is a new ask in the same channel, with the same block-and-end. A resource you lack is something you request, never something you work around: no hunting for a key on the machine, no substituting a dataset the ticket did not name, no quietly running on the CPU when the GPU was refused.

## Fix the harness and the metric first

Before anything is tuned, freeze what "better" means:

- **One evaluation harness** — a script that takes a candidate and prints the metric — and **one metric** with its direction (higher or lower is better). Both are named in the ticket's `## Acceptance criteria` by full path, and **nobody edits them while a loop runs**: not the author, not to "fix" a number that looks wrong. A harness or metric that turns out wrong is a new ticket, and every result logged before the fix is re-run or discarded.
- **One editable surface** — the one file (or the one config) experiments change. Everything else in the experiment directory is fixed. A change that needs a second file is a new ticket with a new baseline.
- **The same time budget for every experiment** — a fixed wall-clock per run (autoresearch's 5 minutes is a good default; the envelope may say otherwise), so two results are comparable. A run that passes **twice** its budget is killed and counted as a crash.
- **The baseline first**: run the untouched surface once through the harness and log it; every later result is read against it.

## The loop

The experiment directory lives in your workspace partition, one per ticket:

```text
<partition>/experiments/<ticket_id>/
  .gitignore        # lists results.tsv and logs/
  eval.*            # the harness — fixed
  <surface>         # the one editable file — the only file a run commits
  results.tsv       # one line per experiment — never committed
  logs/<tag>.log    # each run's output — never committed
```

Initialize it as a git repository (or a sub-tree of one) so that a run is a commit of the surface, never of the record. Write the `.gitignore` first, listing `results.tsv` and `logs/`, and commit it with the harness and the untouched surface as the baseline; from then on `results.tsv` and `logs/` stay untracked. A tracked `results.tsv` makes the checkout that discards a run abort, and forcing past it — `checkout -f`, `reset --hard` — throws away the discard line the reviewer reads. Then, one experiment at a time, in a ticket session:

1. **Hypothesis** — one line: what you change and why it should move the metric.
2. **Branch and edit** — `git checkout -b run-<tag>` from the last kept commit; change the surface; commit the surface alone: `git add <surface> && git commit -m "<tag>: <hypothesis>"`.
3. **Run under the budget** — `timeout <2×budget> <command> > logs/<tag>.log 2>&1`; read the metric from the harness output.
4. **Log one line** in `results.tsv`: `commit<TAB>metric<TAB>peak memory<TAB>status<TAB>description`, status one of `keep`, `discard`, `crash`.
5. **Keep or reset** — `keep` only when the metric beats the best kept result so far; the branch then becomes the new base. Otherwise `discard`: `git checkout <last kept commit>`, then `git branch -D run-<tag>` (`-D`: a discarded run is never merged). The untracked `results.tsv` and `logs/` stay as they are, discard line included.
6. **Crashes** — read the tail of the log (`tail -n 60 logs/<tag>.log`); fix a bug in your own edit and re-run under a new tag, or `discard` a hypothesis that cannot be made to run. Three crashes in a row are a stop: write what you learned in a progress line and pick a different direction, or block the ticket.
7. **Stop** when the envelope's total is reached, when the acceptance criteria are met, or after a run of discards long enough to say the direction is exhausted (ten is a reasonable default). Then a progress line, `## Result` with the best kept commit and its metric, and the hand-off to review below.

Run the loop in the foreground of the ticket session — never in the background beyond it, never from the desk. A sweep that finds a loop's session ended without a final progress line reads `results.tsv` and the log tail before starting the next session.

## Writing the claim

`## Result`, and any paper or report, states the claim as the log supports it: the metric before and after, the kept commit, the baseline, the ablations that separate what mattered from what did not, the seeds and how many, the budget every number was produced under, and every path in full — `results.tsv`, the harness, the deliverable. A number that has no line in `results.tsv` and no commit is not a result; drop it. Say what was not tried and what could still explain the improvement.

## Adversarial review

A claim goes through the board's `review` column, and the reviewer's job is to try to break it. The move itself starts nothing — `notify` hears only of a ticket's close, only the owner may open a session on the ticket, and the owner's sweep starts sessions only for `in_progress` tickets — so on every round the author starts the review itself, right after moving the ticket to `review` with `## Result` complete:

```bash
penguin org ticket move 2026-09-01-dep-eval --to review
penguin org ticket start 2026-09-01-dep-eval --agent-id co_lab_reviewer -m "Review round 1: the claim is in ## Result; results.tsv, logs/ and the harness are in <app_data_dir>/organizations/co_lab/workspace/co_lab_researcher/experiments/2026-09-01-dep-eval/"
```

That session runs as the reviewer, in the reviewer's own partition, with the whole ticket and the note as its first message: name the round and the experiment directory by full path. No mention is needed — it would only wake a desk that cannot open the session.

**The reviewer** works in that session — or, at the CEO's request, in a session on a review ticket of its own — and works down this list, writing what it finds:

- **Reproduce** the key numbers: clone the experiment directory into your partition (`git clone <experiment directory> reviews/<ticket_id>/repro`), check out the kept commit there and run the harness within the envelope's re-run allowance (one run per headline number is the default; more is a new ask); compare against the author's `results.tsv` and logs, read in place by full path — nothing is checked out or run in the author's directory;
- **Baselines and ablations**: is the baseline the untouched surface under the same budget? does each claimed ingredient have an ablation? were the seeds enough for the size of the gain?
- **Leakage and gaming**: any test data in training or tuning? any change to the harness, the metric or the budget between runs? any cherry-picked seed, or a "best of N" reported as one run?
- **Claims against evidence**: does every sentence in `## Result` or the paper have a line in the log behind it? does the novelty stand against the prior work the author cites — and the prior work it does not?

The review is a file in the reviewer's partition, `reviews/<ticket_id>/round-<n>.md`, named in a progress line by full path: a **score** (`accept`, `minor` revision, `major` revision or `reject`), the evidence for each finding, and a numbered list of **required changes**. Then the verdict on the board:

- `accept` — a progress line saying so; the CEO (or whoever the handbook names as the closer) moves the ticket to `done` on that line, and a research ticket is never closed without a reviewer's accept in its history;
- `minor` or `major` — `penguin org ticket move <id> --to in_progress` with a progress line naming the round and the review file; the author's desk picks it up in its next sweep;
- `reject` — a recommendation, not a move: rejecting someone else's ticket is the CEO's proposal to the board. Say so in the stream's channel, @-mentioning the CEO with the review's path.

**The author** answers point by point in `reviews/<ticket_id>/round-<n>-response.md` beside its deliverable — each required change either done (with the commit or the path) or rebutted (with the evidence) — revises, moves the ticket back to `review` and starts the next round's review session the same way. Silence on a point is agreement to fix it.

**The cap**: three rounds. If the third review is not an `accept`, the reviewer blocks the ticket on the CEO — `penguin org ticket block <id> --reason "Not accepted after three review rounds: <the open points>" --by agent:<org_id>_ceo` — and says so in the stream's channel. The CEO decides — accept as it stands, one more round, or split the claim — or takes it to the board in the all-hands channel; the board's word is final.

## Cautions

- **Never touch the harness, the metric or the budget mid-loop.** The comparability of the log is the whole method; a changed harness is a new ticket and a re-run baseline.
- **No result without a log line and a commit.** A number remembered from a terminal is not a result.
- **The envelope is a cap, not a target.** Stop when the criteria are met; stop when the total is reached; ask before either is exceeded — in the channel, never by running "one more" inside the session.
- **The reviewer never fixes the author's code**, and the author never softens a review by editing it; both are read in the ticket's `history`.
- **Costs land on the ticket.** Every loop session and every review session is a contributing session of that ticket; `penguin org finance` shows what a claim cost, and a loop that spends twenty runs without a `keep` is finance's finding as much as yours.
