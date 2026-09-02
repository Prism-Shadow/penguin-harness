/**
 * The organization handbook — `README.md` at the root of the organization directory, the
 * index every work run reads first (progressive loading: the trigger block points here, the
 * handbook points at the files). Generated once at creation from this template; the CEO and
 * HR own it afterwards and may rewrite any of it.
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
- Each employee has one standing **desk session**. Calendar events, chat mentions and ticket
  notices all arrive there as a message that starts with an \`[org_trigger]\` block. The desk
  session schedules work; it does not do the ticket work itself.
- Work is carried by **tickets** on the board. A desk session opens a separate **ticket
  session** for a ticket (\`penguin org ticket start <id>\`), tracks it, checks the result and
  writes progress back. Several sessions and several employees may contribute to one ticket.
- The **group chat** is the organization's public channel. Only \`@<employee>\` and \`@all\`
  deliver a message to someone's desk; everything else is just recorded.
- The **calendar** is the only periodic driver: an event's prompt tells the employee what to
  look at. HR keeps every employee on at least one enabled event.
- **Budgets** are monthly caps per employee (own spend plus every subordinate). Reaching the
  warning ratio posts a system message here; reaching the pause ratio stops that employee's
  calendar until the next month or a raised budget. People can always talk to a desk directly.

## Directory layout

\`${dir}/\`

| Path | What it is | Who writes it |
| --- | --- | --- |
| \`org_config.toml\` | name, mission, status, timezone, approval mode, chat and budget thresholds | people, CEO |
| \`org_chart.yaml\` | employee tree: title, reports_to, duties, workspace, budget, model | CEO, HR (\`penguin org hire\` / \`employee set\`) |
| \`desks.toml\` | employee → current desk session (fact file) | the server |
| \`calendar/<agent_id>/<event>.toml\` | calendar events, one file each (same fields as scheduled tasks, no target) | employees (\`penguin org calendar …\`) |
| \`tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md\` | tickets; the column directory is the status | anyone (\`penguin org ticket …\`) |
| \`chat/<yyyy-mm-dd>.jsonl\` | group chat, one message per line | the server (\`penguin org chat send\`) |
| \`workspace/\` | the shared workspace; the CEO assigns sub-directories to desks | employees |

Paths in prompts use \`<app_data_dir>\` placeholders; resolve them from the Environment section
of your system prompt. Never write absolute paths into files other people read.

## Principals

People and employees are named \`user:<user_id>\` and \`agent:<agent_id>\` in every structured
field (ticket headers, chat senders and mentions). \`all\` means every employee; \`system\` is
the scheduler. In chat text \`@<id>\` is shorthand: employees resolve first, then Project
members; write \`@agent:<id>\` or \`@user:<id>\` when both exist.

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

## Chat etiquette

- Mention someone only for a decision, a blocker, or a completion report. Never \`@all\` for chatter.
- Read the channel with \`penguin org chat tail\` during your calendar sweep.
- Mention chains stop after a few hops on purpose; a person or the calendar restarts the thread.

## Roles

- **CEO** (\`company-ceo\` skill): turns the mission into tickets, hires, partitions the shared
  workspace, reviews tickets, reports to the board in chat.
- **HR** (\`company-hr\` skill): keeps every employee scheduled, hires and offboards, evaluates
  and improves employees, keeps this handbook current.
- **Finance** (\`company-finance\` skill): sets budgets, audits spend daily, explains alerts and
  proposes savings.
- **Everyone** (\`company-employee\` skill): reads this handbook first, sweeps the board, opens
  and tracks ticket sessions, writes results back, blocks instead of idling, reports in chat.

## Command reference

See the \`company-employee\` skill for the full \`penguin org\` command surface. Inside a desk or
ticket session \`--org-id\`, \`--project-id\`, \`--agent-id\` and the current session are already
known from the environment.
`;
}
