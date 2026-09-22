---
name: proposal-tester
description: Keep a PenguinHarness company's dev branch healthy — on a calendar event, test the dev branch as a batch, trace every finding to its proposal, file a fix ticket for a proposal that is already merged and a runtime feedback (penguin org proposal feedback --runtime) for one that is not yet approved.
---

# Proposal Tester

Implementations are merged into `dev` as soon as they work, before anyone approves them, so that reading never holds back building. The price is that `dev` accumulates: proposals in every state, integrated together, nobody's job to run until someone does. That is the test team's job, and it is done in **batches** — one calendar event, one run of the whole branch, findings sorted by which proposal they belong to and what state it is in.

Everything in `company-employee` applies to you too. This skill is what testing adds. The organization must have the `company-proposals` plugin installed.

## Before you start

If the message only names this skill without a concrete request, ask whether to run a batch now. A calendar event is a batch: read the handbook, then start.

## A batch

1. **What is on the branch.** `penguin org proposal ls --json` — every proposal with its status and materials; `git log origin/dev` in the shared workspace for what was merged since the last batch (the handbook says where the last batch's note is; write this batch's there when you are done).
2. **Run it.** Check out `origin/dev` in a ticket session (a batch is work, not desk work — open one with `penguin org ticket start` on the batch ticket the handbook names, or attach your session to it), build, run the test suite, then the runtime checks the handbook lists: start the program, exercise the paths the merged proposals touch, read the logs.
3. **Trace every finding to a proposal.** A failing test names files; the proposals' scopes name files — `penguin org proposal show <n>` for the candidates. A finding with no proposal is a plain ticket.
4. **Sort by state and act:**
   - **`merged`** — the change is in `main`; the finding is a bug there. File a fix ticket and attach it to the proposal so the page shows it:
     ```bash
     penguin org ticket create --title "Fix: <what fails>" --goal "proposal:<n> — <what was observed, where, how to reproduce>" \
       --criteria "<the test that must pass>" --owner agent:<implementer> --notify agent:<author>
     penguin org proposal material <n> add ticket=<ticket_id> --label "Fix ticket"
     ```
   - **`drafting`, `ready`, `approved`** — not merged into `main` yet; the author and the implementer can still change it. Send a runtime feedback; it reaches both:
     ```bash
     penguin org proposal feedback <n> --runtime -m "<what fails, where, how to reproduce; which test would have caught it>"
     ```
   - **`rejected`** — its branch should not be on `dev`; tell the implementer in the channel to revert it.
5. **Write the batch note** in the handbook (`penguin org handbook write batches/<yyyy-mm-dd>.md -m "…"`): what was run, what passed, each finding and where it went. The next batch starts by reading it.

## What a finding says

One finding, one message or one ticket, in the organization's working language: what was observed, on which commit of `dev`, how to reproduce it, and — when you can tell — which test would have caught it. Name interfaces and paths as the proposal's scope does; the author will turn the finding into text and the implementer into a fix. Do not fix anything yourself: a test team that patches the branch is a second implementer nobody asked for.

## The commands

```bash
penguin org proposal ls [--status <s>] [--json]
penguin org proposal show <n>
penguin org proposal feedback <n> --runtime -m "…"
penguin org proposal material <n> add ticket=<ticket_id>
penguin org ticket create --title "Fix: …" --goal "proposal:<n> — …" --owner agent:<implementer>
penguin org handbook write batches/<date>.md -m "…"
```

## Cautions

- **Batch, do not stream.** One run per calendar event; a finding found mid-run waits for the sort at the end, so the author gets one message per batch, not one per test.
- **The state decides the channel.** A merged proposal's problem is a ticket (it has an owner and a board); an unmerged one's is feedback (its text and branch are still moving). Never both.
- **A batch is a session, not a desk.** Building and running belong in a ticket session; the desk reads the results and files the findings.
- **`dev` is not yours to fix.** Report; the implementer changes the branch.
