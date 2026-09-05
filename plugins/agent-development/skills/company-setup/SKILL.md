---
name: company-setup
description: Create a company-mode organization together with the user — collect its id, name, mission, shared workspace, model and CEO budget one question at a time, confirm the whole thing in one summary, then run penguin org create and hand the user over to company mode.
---

# Company Setup

Company mode is the second work mode of PenguinHarness: a Project's Agents organized into a **company** — a CEO at the root of a reporting tree, one standing desk session per employee, a calendar as the only periodic driver, a ticket board that carries the work, channels where `@` mentions interrupt, and monthly budgets that pause spending before it runs away. Creating one takes six facts and a single command.

This skill is how you collect those six facts and run that command. **It ends there.** You never hire, never schedule a calendar event and never file a ticket: creation produces the CEO and nothing else, and the CEO does the rest — after it has proposed a plan and the board (the humans of the Project) has answered.

## Before you start

If the user's message only invokes this skill (e.g. "use company-setup skill") without naming a company to create, ask what organization they want and what it should do. One sentence is enough to start the questions below; do not create anything until every question has an answer and the user has said yes to the summary.

Look before the first question:

```bash
penguin org ls --json     # the Project's organizations, so you never propose a taken id
```

If that call answers `404`, company mode is off for this server (System settings › Server › Company mode). Say so and stop — nothing here can succeed until an admin turns it on.

## Which Project the organization lands in

Inside a harness agent session every command subprocess carries `PENGUIN_API_URL`, `PENGUIN_API_TOKEN` and `PENGUIN_PROJECT_ID`, and `penguin org create` reads that last one as its `--project-id` — so you normally pass no flag and the organization is created in the Project you are running in. Check which one that is before you create anything:

```bash
echo "${PENGUIN_PROJECT_ID:-default_project}"
```

Name the Project in the summary. Pass `--project-id <id>` only when the user explicitly wants a different one.

## Ask one question at a time

One question per message, in the user's own language, in this order. Never batch them into a form and never fill one in yourself: an unanswered question is asked again, not guessed. Each answer is echoed back in the summary at the end, so a mistake costs one line, not a re-run.

1. **Organization id.** The directory name and the id every command takes: `[a-z][a-z0-9_]{1,63}` — a lowercase letter, then lowercase letters, digits and underscores, 2–64 characters. Suggest one derived from what the user has already called the company (lowercase it, transliterate to ASCII, join words with underscores: "Plugin Marketplace" → `plugin_marketplace`) and let them confirm or replace it. If nothing in the conversation names the company yet, ask question 2 first and derive the suggestion from that answer — those two questions swap, the rest of the order does not. Never propose an id already in `penguin org ls`; the server refuses it with `409 org_exists`.
2. **Name.** The display name, free text. Say that leaving it empty makes it the id.
3. **Mission.** One sentence: what the company is for, and how one would know it succeeded. This is the single most load-bearing answer — it becomes the CEO's initialization run, the handbook and the first tickets. A vague mission ("build a website") produces a vague company, so if the user's sentence is broad, **propose a sharper wording** and ask them to confirm or correct it; propose once, do not negotiate it into a paragraph. Their wording wins if they keep it.
4. **Shared workspace.** The company's working directory, which the CEO partitions into a sub-directory per employee. Either an **existing absolute directory** or the default — the organization's own `workspace/` inside the Project directory, which is what most missions want. Offer the default explicitly; if the user names a path, check it exists before you put it in the summary (the server refuses one that does not).
5. **Model.** The provider + model id every desk and ticket session runs on when the employee names none, or the Project's default. Offer the default explicitly; list what is configured only if the user wants to choose:
   ```bash
   penguin config model list      # the configured pairs; `*` marks the Project default
   ```
   The pair is both-or-neither — a provider without a model id is not a model reference.
6. **CEO monthly budget.** USD per calendar month, default **100**. Explain what the number means before taking it: budgets accumulate along the reporting line, so the CEO's budget is the whole company's — every employee's spend rolls up into it. At 80% of it a warning lands in the all-hands channel; at 100% the whole company's calendar stops until the next month or a raised budget. It is a cap, not a spend target, and the board can raise it at any time (`penguin org employee set <org_id>_ceo --budget <usd>`).

## Show the summary and wait for a yes

Before running anything, put all six answers on one screen, in the user's language, and ask for a plain yes:

```text
Organization  plugin_marketplace  (Project: default_project)
Name          Plugin Marketplace
Mission       Build a PenguinHarness plugin marketplace, promote it into the top three search results, and earn from paid featured slots.
Workspace     default (the organization's own workspace/)
Model         Project default
CEO budget    100 USD / month  — the whole company's cap
```

Anything but a clear yes is a correction: change that one line and show the summary again. Do not run the command on a "sure, but …" without settling the "but" first.

## Create it

One command, exactly the answers, nothing else:

```bash
penguin org create --org-id <id> --mission <sentence> \
  [--name <display name>] [--workspace <absolute path>] \
  [--provider <provider> --model-id <model id>] [--ceo-budget <usd>]
```

A complete invocation of the summary above:

```bash
penguin org create --org-id plugin_marketplace \
  --name "Plugin Marketplace" \
  --mission "Build a PenguinHarness plugin marketplace, promote it into the top three search results, and earn from paid featured slots." \
  --ceo-budget 100
```

- `--org-id` is the id to create; unlike every other `penguin org` command it never comes from `PENGUIN_ORG_ID`.
- Omit `--name`, `--workspace` and the model pair when the user took the defaults. `--ceo-budget` defaults to 100, so it may be omitted too — but pass it whenever the user named a number, including `0`.
- The command prints the new organization's id and the CEO's desk session id. Errors surface verbatim: `409 org_exists` (the id, or the CEO's Agent id `<org_id>_ceo`, is taken), `400` with the reason for a bad id, an empty mission, a missing workspace directory or an unconfigured model. Fix the one field and run it again — creation is all-or-nothing and leaves nothing behind when it fails.

## Hand off

Creation writes the organization's files, creates the CEO Agent, opens its desk session and starts an **initialization run** on it. That run has already posted one proposal in the all-hands channel — the CEO's reading of the mission, the streams and first tickets it intends to file, the roles it wants to hire with their budgets, and how it will split the shared workspace — and then stopped, waiting for the board. Tell the user, in their language, exactly that:

- the organization was created and only the CEO exists;
- switch to company mode with the **开发 | 公司** (Development | Company) control at the top of the sidebar, then pick the organization;
- the CEO's proposal is waiting in the all-hands channel and **nothing else happens until the board answers it** — an answer in that channel that `@`-mentions the CEO wakes its desk;
- the CEO hires, partitions the workspace, schedules the calendar and files the tickets itself once it has that answer.

## Cautions

- **Do the CEO's job for it and the company never starts.** No `penguin org hire`, no `penguin org calendar add`, no `penguin org ticket create` from this skill, however obvious the first hire looks — the decision gate is the point: the board approves the plan, then the CEO executes it.
- **One organization per run.** If the user wants a second company, start the questions over; ids, missions and budgets are not shared.
- **Nothing is created before the yes.** The questions are cheap and reversible; the command is not — it creates an Agent and starts a run that spends money.
