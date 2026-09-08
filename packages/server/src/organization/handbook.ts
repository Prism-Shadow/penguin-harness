/**
 * The organization handbook index — `handbook/README.md`; the `handbook/` directory is the
 * company's knowledge base and this file is the one every work run reads first (progressive
 * loading: the trigger block points here, the index points at the files and documents).
 * Generated once at creation from the template of the organization's working language — the
 * two templates carry the same sections and tables, with paths, commands, ids and field
 * names ASCII in both; the CEO and HR own the file afterwards and may rewrite any of it.
 */
import type { OrgLanguage } from "../api/types.js";

export interface HandbookInput {
  orgId: string;
  name: string;
  mission: string;
  ceoAgentId: string;
  createdBy: string;
  /** The organization's working language: which of the two templates is rendered. */
  language: OrgLanguage;
}

export function renderHandbook(input: HandbookInput): string {
  return input.language === "zh" ? renderZh(input) : renderEn(input);
}

function renderEn(input: HandbookInput): string {
  const dir = `<app_data_dir>/organizations/${input.orgId}`;
  return `# ${input.name} — organization handbook

Organization id: \`${input.orgId}\` · CEO: \`${input.ceoAgentId}\` · Board (creator): \`user:${input.createdBy}\`

## Mission

${input.mission}

## Working language

This organization works in English: channel messages, tickets (title, goal, acceptance
criteria, progress, result), handbook documents, calendar prompts and employee briefs are
written in it. Commands, file names, ids and field names stay ASCII.

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
| \`org_config.toml\` | name, mission, status, timezone, working language, approval mode, mention-chain and budget thresholds | people, CEO |
| \`org_chart.yaml\` | employee tree: title, reports_to, duties, workspace, budget, model | CEO, HR (\`penguin org hire\` / \`employee set\`) |
| \`handbook/\` | the knowledge base: this index (\`README.md\`) and the documents it lists | CEO, HR, employees (\`penguin org handbook …\` or file tools) |
| \`desks.toml\` | employee → current desk session (fact file) | the server |
| \`calendar/<agent_id>/<event>.toml\` | calendar events, one file each (same fields as scheduled tasks, no target) | employees (\`penguin org calendar …\`) |
| \`tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md\` | tickets; the column directory is the status | anyone (\`penguin org ticket …\`) |
| \`channels/<channel_id>/channel.toml\` | a channel: name, purpose, members (\`default_channel\` is everyone) | members (\`penguin org channel …\`) |
| \`channels/<channel_id>/<yyyy-mm-dd>.jsonl\` | a channel's messages, one per line | the server (\`penguin org channel send\`) |
| \`workspace/\` (or the \`workspace\` path in \`org_config.toml\`) | the shared workspace; the CEO assigns sub-directories to desks — a relative sub-directory is created by the server when it is assigned, an absolute path must already exist | employees |

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
- Name every input you rely on and every deliverable you produce by its full path (absolute, or
  \`<app_data_dir>/…\`) in \`## Goal\`, \`## Acceptance criteria\`, your progress lines and \`## Result\`;
  a colleague must be able to open it without asking.
- Closing a ticket notifies its \`Notify\` list, and the initiator when it is an employee; a person
  who wants to hear about it lists themselves in \`Notify\`.

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

function renderZh(input: HandbookInput): string {
  const dir = `<app_data_dir>/organizations/${input.orgId}`;
  return `# ${input.name} — 组织手册

组织 id：\`${input.orgId}\` · CEO：\`${input.ceoAgentId}\` · 董事会（创建者）：\`user:${input.createdBy}\`

## 使命

${input.mission}

## 工作语言

本组织的工作语言是中文：频道消息、工单（标题、目标、验收标准、进展、结果）、手册文档、日程提示词与员工简介都用中文书写。命令、文件名、id 与字段名一律保持 ASCII。

## 这家组织如何运转

- 每名员工都是一个 Agent。汇报树写在 \`org_chart.yaml\` 里，根是 CEO。
- 每名员工有且只有一个常设的**工位会话**。日程项、频道里的提及、工单通知，都以一条开头为 \`[org_trigger]\` 块的消息送到这里。工位会话负责调度，不亲自做工单上的活。
- 工作由看板上的**工单**承载。工位会话为一张工单另开一个**工单会话**（\`penguin org ticket start <id>\`），跟踪它、检查结果、回写进展。一张工单可以由多个会话、多名员工共同贡献。
- 交流发生在**频道**里，每个频道是 \`channels/\` 下的一个目录。\`default_channel\` 是全员频道，每名员工与每位董事会成员都在其中；任何人都可以为一条工作线或一张大工单另开频道，并邀请这项工作需要的主体。只有 \`@<员工>\` 与 \`@all\` 会把消息送到某人的工位，且只在该频道的成员范围内生效；其余内容只是记录在案。
- **日历**是唯一的周期性驱动：一条日程项的提示词告诉员工该去看什么。HR 保证每名员工恰有一条各自时点的周期日程——这是轮值表，不是广播：节奏因角色而异（负责人每天、审核者两三天、财务每周），且没有两个工位共用同一个起始分钟。
- **预算**是每名员工的月度上限（自身支出加上全部下属）。达到告警比例会在全员频道发一条系统消息；达到暂停比例则停掉该员工的日历，直到下个月或预算调高为止。人随时可以直接找工位说话。

## 目录结构

\`${dir}/\`

| 路径 | 是什么 | 谁来写 |
| --- | --- | --- |
| \`org_config.toml\` | 名称、使命、状态、时区、工作语言、审批模式、@ 连锁上限与预算阈值 | 人、CEO |
| \`org_chart.yaml\` | 员工树：头衔、reports_to、职责、workspace、预算、Model | CEO、HR（\`penguin org hire\` / \`employee set\`） |
| \`handbook/\` | 知识库：这份索引（\`README.md\`）与它列出的文档 | CEO、HR、员工（\`penguin org handbook …\` 或文件工具） |
| \`desks.toml\` | 员工 → 当前工位会话（事实文件） | 服务端 |
| \`calendar/<agent_id>/<event>.toml\` | 日程项，一项一个文件（字段同定时任务，没有目标字段） | 员工（\`penguin org calendar …\`） |
| \`tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md\` | 工单；所在列目录即状态 | 任何人（\`penguin org ticket …\`） |
| \`channels/<channel_id>/channel.toml\` | 一个频道：名称、用途、成员（\`default_channel\` 是全员） | 成员（\`penguin org channel …\`） |
| \`channels/<channel_id>/<yyyy-mm-dd>.jsonl\` | 频道消息，一行一条 | 服务端（\`penguin org channel send\`） |
| \`workspace/\`（或 \`org_config.toml\` 里的 \`workspace\` 路径） | 公共工作区；CEO 把子目录分给各工位——相对子目录在分配时由服务端创建，绝对路径必须已存在 | 员工 |

提示词里的路径一律用 \`<app_data_dir>\` 占位符，按系统提示词的 Environment 一节解析。绝不要把绝对路径写进别人会读的文件里。

## 身份记号

人和员工在所有结构化字段（工单头部、消息发送者与提及）里都记作 \`user:<user_id>\` 与 \`agent:<agent_id>\`。提及里的 \`all\` 指该频道的全体成员——在全员频道即全体员工；\`system\` 是调度器。消息正文里的 \`@<id>\` 是简写：先解析为员工，再解析为 Project 成员；两者都存在时写 \`@agent:<id>\` 或 \`@user:<id>\`。

## 工单协议

- 列：\`proposed\` → \`in_progress\` → \`review\`（可选）→ \`done\`，或 \`rejected\`（须给出理由）。
- 任何人都可以提出。由 CEO、负责人的上级或某个人接受（→ in_progress）或拒绝。
- 负责人把完成的工单移到 \`review\`；由 CEO 或某个人移到 \`done\`。验收标准明显已满足的 P2 工单可以直接进 \`done\`。
- 工单会话结束前要写进展（\`penguin org ticket progress <id> -m …\`），工作完成则移列。
- 卡住了（等人拍板、等另一张工单、缺一把 key）：\`penguin org ticket block <id> --reason … --by …\`，然后停手。被阻塞的工单在解除之前会被巡检跳过。
- \`## Goal\`、\`## Acceptance criteria\`、进展行与 \`## Result\` 里的每个参考物与交付物都写**完整路径**（绝对路径或 \`<app_data_dir>/…\`），同事不用问就能打开。
- 关闭一张工单会通知它的 \`Notify\` 名单，发起人是员工时也通知发起人；想收到通知的人把自己列进 \`Notify\`。

## 决策属于董事会

CEO 提案，董事会（创建者 \`user:${input.createdBy}\`）拍板。招募之前（哪些角色、多少预算、用什么 Model）、设定或调高预算之前、拒绝他人的工单或未经审核就关闭 P0 / P1 工单之前、任何触及组织之外的动作之前（发布、注册账号、花钱），以及修改本手册或组织结构之前，CEO 都要在全员频道发一份清楚的提案并 @ 董事会，然后停下来等答复。员工把这类事项上报给自己的上级，由 CEO 带到董事会。已批准计划之内的日常工作不需要再确认。

## 频道礼仪

- 只在需要拍板、出现阻塞或汇报完成时提及别人。绝不为闲谈 \`@all\`。
- 在触发块指明的频道里作答（它的 \`channel:\` 行）：\`penguin org channel send --channel <id> -m …\`。日历巡检时读一遍自己所在的频道：\`penguin org channel ls\`，再 \`penguin org channel tail --channel <id>\`。
- 一条线索会淹没全员频道时就另开频道——一条工作线或一张大工单一个（\`penguin org channel create <id>\`），只邀请这项工作需要的主体（\`penguin org channel invite <id> <principal>\`），并在全员频道里说明一次。
- 你只在自己是成员的频道里读和发；员工只有被成员邀请才会加入一个频道。需要董事会拍板的事情要发到全员频道——他们在那里读。
- 提及了不在该频道的人，整条消息会被拒收：先邀请对方。
- @ 连锁在若干跳之后会有意停止；由人或日历重新发起线索。

## 角色

- **CEO**（\`company-ceo\` Skill）：把使命拆成工单、招募、划分公共工作区、为每条工作线开一个频道并邀请其负责人、审核工单、在全员频道向董事会汇报。
- **HR**（\`company-hr\` Skill）：保证每名员工都有日程、负责招募与离职、评估并改进员工、维护本手册。
- **财务**（\`company-finance\` Skill）：设定预算、每天审计支出、解释告警并提出节流方案。
- **所有人**（\`company-employee\` Skill）：先读本手册、巡检看板、发起并跟踪工单会话、回写结果、卡住就标阻塞而不是空转、在自己的频道里汇报。

## 知识库

这个目录（\`handbook/\`）是公司的知识库，本文件是它的索引——每轮触发最先读的那一个文件。把可以长期沿用的知识放在这里，一个主题一个 Markdown 文件：董事会做出的决定（\`decisions/<yyyy-mm-dd>-<slug>.md\`）、约定、操作指南、产品与市场事实，以及任何不该让下一轮再重新摸索一遍的东西。每份文档都要在下面列出并用一行说明它何时相关，好让一轮运行只在那一行说了相关时才去读它。\`penguin org handbook list | show <path> | write <path>\` 用来读写文档；索引本身不可删除。

## 文档

_暂无。_

## 命令参考

完整的 \`penguin org\` 命令面见 \`company-employee\` Skill。在工位会话或工单会话内，\`--org-id\`、\`--project-id\`、\`--agent-id\` 与当前会话都已由环境给出。
`;
}
