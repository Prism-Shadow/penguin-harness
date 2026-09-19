/**
 * The organization handbook index — `handbook/README.md`; the `handbook/` directory is the
 * company's knowledge base and this file is the one every work run reads first (progressive
 * loading: the trigger block points here, the index points at the files and documents).
 * Generated once in English; the CEO and HR own the file afterwards.
 */
import type { OrgLanguage } from "../api/types.js";

export interface HandbookInput {
  orgId: string;
  name: string;
  mission: string;
  ceoAgentId: string;
  createdBy: string;
  /** The organization's working language: used for subsequent employee work. */
  language: OrgLanguage;
}

export function renderHandbook(input: HandbookInput): string {
  return renderEn(input);
}

function renderEn(input: HandbookInput): string {
  const dir = `<app_data_dir>/organizations/${input.orgId}`;
  return `# ${input.name} — organization handbook

Organization id: \`${input.orgId}\` · CEO: \`${input.ceoAgentId}\` · Board (creator): \`user:${input.createdBy}\`

## Mission

${input.mission}

## Working language

This organization works in ${input.language === "en" ? "English" : "the configured language (" + input.language + ")"}: channel messages, tickets (title, goal, acceptance
criteria, progress, result), handbook documents, calendar prompts and employee briefs are
written in it. Commands, file names, ids and field names stay ASCII.

## How this organization runs

- Every employee is an Agent. The reporting tree lives in \`org_chart.yaml\`; the CEO is the root.
- Each employee has one standing **desk session**. Calendar events and channel mentions arrive
  there as a message that starts with an \`[org_trigger]\` block; ticket changes are listed in the
  next calendar sweep, never sent on their own. The desk session schedules work; it does not do
  the ticket work itself.
- Work is carried by **tickets** on the board. A ticket's owner opens a separate **ticket
  session** for it from its desk (\`penguin org ticket start <id>\`), tracks it, checks the result
  and writes progress back. Only the owner's desk — or a person — starts a ticket's sessions:
  work moves to another employee by reassigning the ticket
  (\`penguin org ticket assign <id> --owner agent:<employee>\`), and that desk picks it up in its
  next sweep. The owner may add \`--agent-id <colleague>\` to enlist a colleague on its own
  ticket. Several sessions and several employees may contribute to one ticket.
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
| \`org_config.toml\` | name, mission, status, timezone, working language, approval mode, mention-chain and budget thresholds | people, CEO |
| \`org_chart.yaml\` | employee tree: title, reports_to, duties, workspace, budget, model | CEO, HR (\`penguin org hire\` / \`employee set\`) |
| \`handbook/\` | the knowledge base: this index (\`README.md\`) and the documents it lists | CEO, HR, employees (\`penguin org handbook …\` or file tools) |
| \`desks.toml\` | employee → current desk session (fact file) | the server |
| \`calendar/<agent_id>/<event>.toml\` | calendar events, one file each (same fields as scheduled tasks, no target) | employees (\`penguin org calendar …\`) |
| \`tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md\` | tickets; the column directory is the status | anyone (\`penguin org ticket …\`) |
| \`channels/<channel_id>/channel.toml\` | a channel: name, purpose, members (\`default_channel\` is everyone) | members (\`penguin org channel …\`) |
| \`channels/<channel_id>/<yyyy-mm-dd>.jsonl\` | a channel's messages, one per line | the server (\`penguin org channel send\`) |
| \`workspace/\` (or the \`workspace\` path in \`org_config.toml\`) | the shared workspace; its root holds the shared inputs and is nobody's desk — the CEO works in \`ceo/\`, a hire lands in a sub-directory named after its Agent id unless another one is assigned, and a relative sub-directory is created by the server as it is assigned (an absolute path must already exist) | employees |

Paths in prompts use \`<app_data_dir>\` placeholders; resolve them from the Environment section
of your system prompt. Never write absolute paths into files other people read.

## Principals

People and employees are named \`user:<user_id>\` and \`agent:<agent_id>\` in every structured
field (ticket fields, message senders and mentions). \`all\` in a mention means every member of
that channel — in the all-hands channel, every employee; \`system\` is the scheduler. In message
text \`@<id>\` is shorthand: employees resolve first, then Project members; write
\`@agent:<id>\` or \`@user:<id>\` when both exist.

## Ticket protocol

- A ticket file is YAML frontmatter (\`title\`, \`status\`, \`owner\`, \`notify\`, \`priority\`, \`due\`,
  \`blocked\`, \`sessions\`, \`history\`) followed by \`## Goal\`, \`## Acceptance criteria\`,
  \`## Progress\` and \`## Result\`. Its id is \`<yyyy-mm-dd>-<slug>\`, the slug lowercase English
  words joined by hyphens.
- Columns: \`proposed\` → \`in_progress\` → \`review\` (optional) → \`done\`, or \`rejected\` (give a reason).
- **One owner.** \`owner\` is the single principal responsible for the ticket — whoever filed it
  unless the filing named someone else — and \`history\` records who filed it and everything since.
- Anyone may propose. The CEO, the owner's manager or a person accepts (→ in_progress) or rejects.
- The owner moves a finished ticket to \`review\`; the CEO or a person moves it to \`done\`.
  P2 tickets may go straight to \`done\` when the acceptance criteria are plainly met.
- Before a ticket session ends it writes progress (\`penguin org ticket progress <id> -m …\`) and
  moves the ticket if the work is complete. \`## Progress\` is plain sentences: what was done and
  where. No ids, no timestamps, no names — the server records who wrote each line and when.
- Stuck (waiting for a decision, another ticket, a missing key): \`penguin org ticket block <id>
  --reason … --by …\` and stop working on it. Blocked tickets are skipped by the sweep until unblocked.
- Name every input you rely on and every deliverable you produce by its full path (absolute, or
  \`<app_data_dir>/…\`) in \`## Goal\`, \`## Acceptance criteria\`, your progress lines and \`## Result\`;
  a colleague must be able to open it without asking.
- Closing a ticket notifies its \`notify\` list, and its owner when an employee owns it; a person
  who wants to hear about it lists themselves in \`notify\`. Ticket changes are never posted in a
  channel: the board is read from the board.

## Decisions belong to the board

The CEO proposes; the board (the creator, \`user:${input.createdBy}\`) decides. Before hiring
(which roles, with what budgets), before setting or raising a budget or changing an employee's
model, before rejecting someone else's ticket or closing a P0 / P1 ticket without review, and
before changing this handbook or the organization's structure, the CEO posts one clear proposal
in the all-hands channel mentioning the board and stops until the answer comes back. Employees
raise such matters to their manager; the CEO takes them to the board. Every employee runs on the
organization's model (\`model\` in \`org_config.toml\`), or on the Project's default model when the
organization names none, unless the board named another for that employee; nobody assigns models
per role on their own. Routine work inside an accepted plan needs no confirmation.

## Ask before it touches the machine or the outside

Whatever touches the machine this organization runs on, spends money or reaches outside the
organization is asked of the board first — by the employee who needs it, in the all-hands
channel — and starts only on a clear yes:

- heavy or long compute: training or evaluation runs, large builds, big parallel jobs, anything
  that saturates the CPU or a GPU for more than a few minutes, a download over 1 GB, a process
  meant to outlive the run;
- money and the outside: paid APIs or services beyond the model calls, publishing, pushing to a
  shared remote, mail or messages to outsiders, registering accounts, exposing a port;
- anything outside the shared workspace (the user's other files, system settings, global
  installs) and anything irreversible (deleting data one did not create, rewriting shared
  history, dropping a database, overwriting the shared inputs);
- a credential or secret one needs but does not have — asked of the person who owns it, never
  searched for, never copied into a ticket, a channel or this handbook.

The ask is one message mentioning \`@user:${input.createdBy}\`: what will run, estimated duration
and resources, how to stop it, the alternative if the answer is no. Then
\`penguin org ticket block <id> --reason … --by user:${input.createdBy}\` and the end of the run;
the answer comes back as a mention. Noticeable steps inside an accepted plan — a multi-minute
build, a project-local install, a smaller download — are announced in a progress line and then
done; routine work in one's own partition is simply done.

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
- **Authors and reviewers** (\`company-research\` skill, in a research organization): fix the
  harness and the metric, run the experiment loop inside a resource envelope the board approved,
  and put every claim through a reviewer who is not its author.
- **Everyone** (\`company-employee\` skill): reads this handbook first, sweeps the board, opens
  and tracks ticket sessions, writes results back, blocks instead of idling, asks the board
  before anything heavy, costly, irreversible or outside the workspace, reports in its channels.

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
