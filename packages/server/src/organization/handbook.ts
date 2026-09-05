/**
 * The organization handbook index — `handbook/README.md`; the `handbook/` directory is the
 * company's knowledge base and this file is the one every work run reads first (progressive
 * loading: the trigger block points here, the index points at the files and documents).
 * Generated once at creation from this template; the CEO and HR own it afterwards and may
 * rewrite any of it.
 */

export interface HandbookInput {
  orgId: string;
  name: string;
  mission: string;
  ceoAgentId: string;
  createdBy: string;
}

export function renderHandbook(input: HandbookInput): string {
  const dir = `<app_data_dir>/organizations/${input.orgId}`;
  return `# ${input.name} — organization handbook

Organization id: \`${input.orgId}\` · CEO: \`${input.ceoAgentId}\` · Board (creator): \`user:${input.createdBy}\`

## Mission

${input.mission}

## How this organization runs

- Every employee is an Agent. The reporting tree lives in \`org_chart.yaml\`; the CEO is the root.
- Each employee has one standing **desk session**. Calendar events, channel mentions and ticket
  notices all arrive there as a message that starts with an \`[org_trigger]\` block. The desk
  session schedules work; it does not do the ticket work itself.
- Work is carried by **tickets** on the board. A desk session opens a separate **ticket
  session** for a ticket (\`penguin org ticket start <id>\`), tracks it, checks the result and
  writes progress back. Several sessions and several employees may contribute to one ticket.
- Talking happens in **channels**, each a directory under \`channels/\`. \`default_channel\` is the
  all-hands channel every employee and every board member is in; anyone may open more for a stream or a
  big ticket and invite the principals that work needs. Only \`@<employee>\` and \`@all\` deliver
  a message to someone's desk, and only inside the channel's own membership; everything else is
  just recorded.
- The **calendar** is the only periodic driver: an event's prompt tells the employee what to
  look at. HR keeps every employee on exactly one recurring event at its own hour — a rota,
  not a broadcast: cadences differ by role (daily owners, 2–3 days for reviewers, weekly for
  finance) and no two desks share a start minute.
- **Budgets** are monthly caps per employee (own spend plus every subordinate). Reaching the
  warning ratio posts a system message in the all-hands channel; reaching the pause ratio stops
  that employee's calendar until the next month or a raised budget. People can always talk to a
  desk directly.

## Directory layout

\`${dir}/\`

| Path | What it is | Who writes it |
| --- | --- | --- |
| \`org_config.toml\` | name, mission, status, timezone, approval mode, mention-chain and budget thresholds | people, CEO |
| \`org_chart.yaml\` | employee tree: title, reports_to, duties, workspace, budget, model | CEO, HR (\`penguin org hire\` / \`employee set\`) |
| \`handbook/\` | the knowledge base: this index (\`README.md\`) and the documents it lists | CEO, HR, employees (\`penguin org handbook …\` or file tools) |
| \`desks.toml\` | employee → current desk session (fact file) | the server |
| \`calendar/<agent_id>/<event>.toml\` | calendar events, one file each (same fields as scheduled tasks, no target) | employees (\`penguin org calendar …\`) |
| \`tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md\` | tickets; the column directory is the status | anyone (\`penguin org ticket …\`) |
| \`channels/<channel_id>/channel.toml\` | a channel: name, purpose, members (\`default_channel\` is everyone) | members (\`penguin org channel …\`) |
| \`channels/<channel_id>/<yyyy-mm-dd>.jsonl\` | a channel's messages, one per line | the server (\`penguin org channel send\`) |
| \`workspace/\` (or the \`workspace\` path in \`org_config.toml\`) | the shared workspace; the CEO assigns sub-directories to desks | employees |

Paths in prompts use \`<app_data_dir>\` placeholders; resolve them from the Environment section
of your system prompt. Never write absolute paths into files other people read.

## Principals

People and employees are named \`user:<user_id>\` and \`agent:<agent_id>\` in every structured
field (ticket headers, message senders and mentions). \`all\` in a mention means every member of
that channel — in the all-hands channel, every employee; \`system\` is the scheduler. In message
text \`@<id>\` is shorthand: employees resolve first, then Project members; write
\`@agent:<id>\` or \`@user:<id>\` when both exist.

## Ticket protocol

- Columns: \`proposed\` → \`in_progress\` → \`review\` (optional) → \`done\`, or \`rejected\` (give a reason).
- Anyone may propose. The CEO, the owner's manager or a person accepts (→ in_progress) or rejects.
- The owner moves a finished ticket to \`review\`; the CEO or a person moves it to \`done\`.
  P2 tickets may go straight to \`done\` when the acceptance criteria are plainly met.
- Before a ticket session ends it writes progress (\`penguin org ticket progress <id> -m …\`) and
  moves the ticket if the work is complete.
- Stuck (waiting for a decision, another ticket, a missing key): \`penguin org ticket block <id>
  --reason … --by …\` and stop working on it. Blocked tickets are skipped by the sweep until unblocked.
- Closing a ticket notifies its \`Notify\` list and the initiator.

## Decisions belong to the board

The CEO proposes; the board (the creator, \`user:${input.createdBy}\`) decides. Before hiring
(which roles, budgets, models), before setting or raising a budget, before rejecting someone
else's ticket or closing a P0 / P1 ticket without review, before anything that reaches outside
the organization (publishing, accounts, money) and before changing this handbook or the
organization's structure, the CEO posts one clear proposal in the all-hands channel mentioning
the board and stops until the answer comes back. Employees raise such matters to their manager;
the CEO takes them to the board. Routine work inside an accepted plan needs no confirmation.

## Channel etiquette

- Mention someone only for a decision, a blocker, or a completion report. Never \`@all\` for chatter.
- Answer in the channel the trigger names (its \`channel:\` line):
  \`penguin org channel send --channel <id> -m …\`. During your calendar sweep read the channels
  you are in: \`penguin org channel ls\`, then \`penguin org channel tail --channel <id>\`.
- Open a channel when a thread would drown the all-hands channel — one per stream or per big
  ticket (\`penguin org channel create <id>\`), invite exactly the principals the work needs
  (\`penguin org channel invite <id> <principal>\`), and say so once in the all-hands channel.
- You read and post only in channels you are a member of, and an employee joins one only when a
  member invites it. What the board must decide goes to the all-hands channel, where they read.
- A message that mentions someone who is not in the channel is refused: invite them first.
- Mention chains stop after a few hops on purpose; a person or the calendar restarts the thread.

## Roles

- **CEO** (\`company-ceo\` skill): turns the mission into tickets, hires, partitions the shared
  workspace, opens one channel per stream and invites its owners, reviews tickets, reports to
  the board in the all-hands channel.
- **HR** (\`company-hr\` skill): keeps every employee scheduled, hires and offboards, evaluates
  and improves employees, keeps this handbook current.
- **Finance** (\`company-finance\` skill): sets budgets, audits spend daily, explains alerts and
  proposes savings.
- **Everyone** (\`company-employee\` skill): reads this handbook first, sweeps the board, opens
  and tracks ticket sessions, writes results back, blocks instead of idling, reports in its channels.

## Knowledge base

This directory (\`handbook/\`) is the company's knowledge base and this file is its index —
the one file every run reads first. Keep durable knowledge here, one Markdown file per
subject: decisions the board took (\`decisions/<yyyy-mm-dd>-<slug>.md\`), conventions,
how-tos, product and market facts, anything the next run must not have to rediscover.
List every document below with one line saying when it matters, so a run reads a document
only when its line says so. \`penguin org handbook list | show <path> | write <path>\`
reads and writes documents; the index cannot be deleted.

## Documents

_None yet._

## Command reference

See the \`company-employee\` skill for the full \`penguin org\` command surface. Inside a desk or
ticket session \`--org-id\`, \`--project-id\`, \`--agent-id\` and the current session are already
known from the environment.
`;
}
