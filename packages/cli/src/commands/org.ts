/**
 * `penguin org` — company mode: a thin client over the organization API. Every
 * subcommand addresses one organization of one Project. The organization's files under
 * the Project directory (the employee tree, the desks ledger, calendar, tickets, chat)
 * stay the single source of truth; each command reads a projection of them or writes
 * through the route that edits them, with the same validated-writer contract `schedule`
 * has — API errors surface verbatim, so an agent gets synchronous validation.
 *
 *   penguin org ls [--project-id <id>] [--json] [--server <url>]
 *   penguin org create --org-id <id> --mission <s> [--name <s>]
 *   penguin org show | chart
 *   penguin org hire (--agent-id <id> | --new-agent <id> [--name] [--description] [--skills <a,b>])
 *                    --title <s> --reports-to <agent_id> [--workspace <path>] [--budget <usd>] [--duties <s>]
 *   penguin org employee set <agent_id> [--title] [--reports-to] [--workspace] [--budget] [--duties]
 *                    [--model-id <id> --provider <p>]
 *   penguin org leave <agent_id>
 *   penguin org desk show|renew [<agent_id>]
 *   penguin org calendar ls [--agent-id] | add <name> … | update <name> … | rm <name>
 *   penguin org ticket ls [--status] [--owner] [--blocked] | show <id> | create … | move <id> --to <col>
 *                    | assign <id> --owner <p> | block <id> --reason <s> [--by] | unblock <id>
 *                    | progress <id> -m <text> | start <id> [-m] [--workspace] | attach <id> [--session]
 *   penguin org chat tail [--date <d>] [-n <count>] | send -m <text> [--ref-ticket] [--ref-session]
 *   penguin org handbook list | show [path] | write <path> (-m <text> | --file <f>) | rm <path>
 *   penguin org finance [--period <yyyy-mm>]
 *
 * Every subcommand takes `--org-id` (default: PENGUIN_ORG_ID, the variable company mode
 * adds to the control environment of desk and ticket sessions; there is no default
 * organization), `--project-id`, `--json` and `--server`. The same environment
 * identifies the caller: `--agent-id` on the calendar commands and the desk positional
 * default to PENGUIN_AGENT_ID; `ticket start` sends it as the employee the ticket
 * session runs as (the server otherwise picks the ticket owner); the ticket writes and
 * `chat send` carry PENGUIN_SESSION_ID so the file records the employee rather than the
 * token's user, and `ticket attach` attaches that session by default. `--json` prints
 * the response DTO as one line (`ticket ls` its filtered list, `chat tail` the messages
 * it shows); write commands otherwise print a one-line confirmation.
 * Docs: /docs/cli § "penguin org".
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type {
  OrgCalendarItem,
  OrgCalendarResponse,
  OrgChartResponse,
  OrgChatMessage,
  OrgChatResponse,
  OrgHandbookFileResponse,
  OrgHandbookFilesResponse,
  OrgDeskResponse,
  OrgEmployeeItem,
  OrgFinanceResponse,
  OrgTicketDetail,
  OrgTicketItem,
  OrgTicketPriority,
  OrgTicketStartResponse,
  OrgTicketStatus,
  OrgTicketsResponse,
  OrganizationDetail,
  OrganizationsResponse,
} from "@prismshadow/penguin-server/api";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  resolveSessionRef,
  ServerClient,
} from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const enc = encodeURIComponent;

/** The kanban columns in board order (the server's ORG_TICKET_COLUMNS; only its types are imported here). */
const TICKET_COLUMNS: readonly OrgTicketStatus[] = [
  "proposed",
  "in_progress",
  "review",
  "done",
  "rejected",
];
const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];
/** `chat tail` without `-n`. */
const DEFAULT_CHAT_COUNT = 20;

// ---------------------------------------------------------------------------
// Scope: the organization, its Project and the connection
// ---------------------------------------------------------------------------

interface OrgScope {
  client: ServerClient;
  projectId: string;
  orgId: string;
  /** `/api/projects/:p/organizations/:orgId`. */
  base: string;
}

/** Prints a localized error line and marks the exit code; the caller returns. */
function fail(t: Messages, message: string): void {
  process.stderr.write(`${t.error(message)}\n`);
  process.exitCode = 1;
}

/**
 * Refuses a caller-supplied id or handbook path holding a `.` / `..` segment: those survive
 * encodeURIComponent, and the URL parser then collapses them onto a different route —
 * `employees/..` is the organization itself, whose DELETE removes the whole company. True
 * after the error, and the caller returns.
 */
function refuseDotSegments(value: string, t: Messages): boolean {
  if (!value.split("/").some((segment) => segment === "." || segment === "..")) return false;
  fail(t, t.org.pathSegmentInvalid(value));
  return true;
}

/**
 * Resolves the organization's coordinates and connects. `--org-id` defaults to
 * PENGUIN_ORG_ID and to nothing else; it is read before the connection so a missing one
 * never auto-starts a server. Null after the error.
 */
async function orgScope(
  opts: { orgId?: string; projectId?: string; server?: string },
  t: Messages,
): Promise<OrgScope | null> {
  const orgId = opts.orgId?.trim() || process.env.PENGUIN_ORG_ID?.trim() || "";
  if (orgId === "") {
    fail(t, t.org.orgIdMissing());
    return null;
  }
  const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
  const projectId = resolveProjectId(opts.projectId);
  return {
    client,
    projectId,
    orgId,
    base: `/api/projects/${enc(projectId)}/organizations/${enc(orgId)}`,
  };
}

/** The options every organization-scoped leaf command takes, appended after its own. */
function scoped(cmd: Command, t: Messages): Command {
  return cmd
    .option("--org-id <id>", t.org.orgId)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server);
}

/** The calling session (the control environment's PENGUIN_SESSION_ID), when the CLI runs inside one. */
function callerSessionId(): string | undefined {
  return process.env.PENGUIN_SESSION_ID?.trim() || undefined;
}

/** `{ sessionId }` for a write body inside a session, so the file records the employee rather than the token's user. */
function actorFields(): { sessionId?: string } {
  const sessionId = callerSessionId();
  return sessionId !== undefined ? { sessionId } : {};
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

// ---------------------------------------------------------------------------
// Value parsing and formatting
// ---------------------------------------------------------------------------

/** `--start-at` value: the literal `now` becomes the current instant; anything else passes through for the server to validate. */
function resolveStartAt(raw: string): string {
  return raw.trim().toLowerCase() === "now" ? new Date().toISOString() : raw;
}

/** A comma-separated flag value as a trimmed list; undefined when absent or empty. */
function commaList(raw: unknown): string[] | undefined {
  if (typeof raw !== "string") return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/** `--budget <usd>`: a non-negative number. Null after the error. */
function parseBudget(raw: string, t: Messages): number | null {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || value < 0) {
    fail(t, t.org.budgetInvalid(raw));
    return null;
  }
  return value;
}

/** A kanban column name (`--status`, `--to`). Null after the error. */
function parseColumn(raw: string, t: Messages): OrgTicketStatus | null {
  if ((TICKET_COLUMNS as readonly string[]).includes(raw)) return raw as OrgTicketStatus;
  fail(t, t.org.statusInvalid(raw));
  return null;
}

/** `--priority`: P0 / P1 / P2. Null after the error. */
function parsePriority(raw: string, t: Messages): OrgTicketPriority | null {
  if ((PRIORITIES as readonly string[]).includes(raw)) return raw as OrgTicketPriority;
  fail(t, t.org.priorityInvalid(raw));
  return null;
}

/** `-n <count>`: a positive integer. Null after the error. */
function parseCount(raw: string, t: Messages): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(t, t.org.countInvalid(raw));
    return null;
  }
  return value;
}

/** Costs print with four decimals (cents matter at these magnitudes), budgets with two. */
const usd = (cost: number): string => `$${cost.toFixed(4)}`;
const usdBudget = (budget: number): string => `$${budget.toFixed(2)}`;

/** `$cost / $budget (ratio%)`, or the bare cost without a budget. */
function spendText(spend: { cost: number; budget?: number; ratio?: number }): string {
  if (spend.budget === undefined) return usd(spend.cost);
  return `${usd(spend.cost)} / ${usdBudget(spend.budget)}${ratioText(spend.ratio)}`;
}

/** Budget cell: `$budget (ratio%)`, or `-` when unbounded. */
function budgetText(budget: number | undefined, ratio: number | undefined): string {
  return budget === undefined ? "-" : `${usdBudget(budget)}${ratioText(ratio)}`;
}

function ratioText(ratio: number | undefined): string {
  return ratio === undefined ? "" : ` (${Math.round(ratio * 100)}%)`;
}

function isBlocked(item: { blocked?: string }): boolean {
  return item.blocked !== undefined && item.blocked !== "";
}

/**
 * Depth-first order over a reports-to tree: the roots (no manager) first, each followed by
 * its subordinates one level deeper, siblings in their listed order. An employee whose
 * manager is not listed (or sits in a cycle) is appended at the root level so nothing goes
 * unlisted.
 */
function treeOrder<T extends { agentId: string; reportsTo: string | null }>(
  items: readonly T[],
): Array<{ item: T; depth: number }> {
  const out: Array<{ item: T; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): void => {
    for (const item of items) {
      if (item.reportsTo !== parent || seen.has(item.agentId)) continue;
      seen.add(item.agentId);
      out.push({ item, depth });
      walk(item.agentId, depth + 1);
    }
  };
  walk(null, 0);
  for (const item of items) {
    if (seen.has(item.agentId)) continue;
    seen.add(item.agentId);
    out.push({ item, depth: 0 });
  }
  return out;
}

const indent = (depth: number, text: string): string => `${"  ".repeat(depth)}${text}`;

// ---------------------------------------------------------------------------
// Human views
// ---------------------------------------------------------------------------

/** `show`: one line per fact — identity, mission, people, board, money, what waits for the caller. */
function renderDetail(d: OrganizationDetail, t: Messages): string {
  const board = TICKET_COLUMNS.map((column) => `${column} ${d.board[column]}`).join(", ");
  const lines = [
    t.org.showHead(d.name, d.orgId, d.status),
    t.org.showMission(d.mission),
    t.org.showEmployees(d.employeeCount, d.runningCount, d.pausedCount),
    t.org.showBoard(board, d.blockedTickets),
    t.org.showSpend(d.spend.period, spendText(d.spend)),
    t.org.showPending(
      d.pending.mentions,
      d.pending.reviewTickets.length,
      d.pending.blockedByMe.length,
    ),
    ...(d.invalid !== undefined ? [t.org.invalid(d.invalid)] : []),
  ];
  return `${lines.join("\n")}\n`;
}

/** `chart`: the tree as a table whose first column is indented by depth. */
function renderChart(res: OrgChartResponse, t: Messages): string {
  return renderTable(
    [
      t.agent.colId(),
      t.agent.colName(),
      t.org.colJobTitle(),
      t.org.colState(),
      t.org.colOwn(),
      t.org.colCumulative(),
      t.org.colBudget(),
      t.org.colNote(),
    ],
    treeOrder(res.employees).map(({ item: e, depth }) => [
      indent(depth, e.agentId),
      e.name,
      e.title,
      e.state,
      usd(e.spend.own),
      usd(e.spend.cumulative),
      budgetText(e.budget, e.spend.ratio),
      e.invalid !== undefined ? t.org.invalid(e.invalid) : "",
    ]),
  );
}

/** `ticket show`: the derived figures the file cannot carry, then the file itself. */
function renderTicket(d: OrgTicketDetail, t: Messages): string {
  const head = [
    t.org.ticketHead(d.ticketId, d.status, d.running, isBlocked(d) ? d.blocked : undefined),
    t.org.ticketFigures(usd(d.cost), usd(d.rolledUpCost), d.sessions.length, d.children.length),
    ...(d.invalid !== undefined ? [t.org.invalid(d.invalid)] : []),
  ];
  const body = d.body.endsWith("\n") ? d.body : `${d.body}\n`;
  return `${head.join("\n")}\n\n${body}`;
}

/** `finance`: employees along the reporting line, then tickets, then the total. */
function renderFinance(res: OrgFinanceResponse, t: Messages): string {
  const employees = renderTable(
    [
      t.agent.colId(),
      t.org.colJobTitle(),
      t.org.colOwn(),
      t.org.colCumulative(),
      t.org.colBudget(),
      t.schedule.colStatus(),
    ],
    treeOrder(res.employees).map(({ item: e, depth }) => [
      indent(depth, e.agentId),
      e.title,
      usd(e.own),
      usd(e.cumulative),
      budgetText(e.budget, e.ratio),
      e.paused ? "paused" : e.warned ? "warned" : "",
    ]),
  );
  const tickets =
    res.tickets.length === 0
      ? ""
      : `\n${renderTable(
          [
            t.org.colTicket(),
            t.schedule.colStatus(),
            t.cost.colCost(),
            t.org.colRolledUp(),
            t.org.colTitle(),
          ],
          res.tickets.map((x) => [x.ticketId, x.status, usd(x.cost), usd(x.rolledUp), x.title]),
        )}`;
  return `${employees}${tickets}\n${t.org.financeTotal(res.period, usd(res.total))}\n`;
}

/** One chat message per line: `time  sender  text` (a multi-line text keeps its lines). */
function chatLine(m: OrgChatMessage): string {
  return `${m.time}  ${m.sender}  ${m.text}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerOrgCommand(program: Command, t: Messages): void {
  const org = program.command("org").description(t.org.desc);

  org
    .command("ls")
    .description(t.org.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<OrganizationsResponse>(
        "GET",
        `/api/projects/${enc(projectId)}/organizations`,
      );
      if (opts.json === true) {
        printJson(res);
        return;
      }
      if (res.organizations.length === 0) {
        printLine(t.org.empty(projectId));
        return;
      }
      process.stdout.write(
        renderTable(
          [
            t.agent.colId(),
            t.agent.colName(),
            t.schedule.colStatus(),
            t.org.colEmployees(),
            t.org.colRunning(),
            t.org.colOpen(),
            t.org.colBlocked(),
            t.org.colSpend(),
            t.org.colNote(),
          ],
          res.organizations.map((o) => [
            o.orgId,
            o.name,
            o.status,
            String(o.employeeCount),
            String(o.runningCount),
            String(o.openTickets),
            String(o.blockedTickets),
            spendText(o.spend),
            o.invalid !== undefined ? t.org.invalid(o.invalid) : "",
          ]),
        ),
      );
    });

  org
    .command("create")
    .description(t.org.createDesc)
    .requiredOption("--org-id <id>", t.org.newOrgId)
    .requiredOption("--mission <text>", t.org.mission)
    .option("--name <name>", t.org.orgName)
    .option("--workspace <path>", t.common.workspace)
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <name>", t.common.provider)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      // A model reference is always the complete (provider, modelId) pair, like everywhere else.
      if ((opts.modelId !== undefined) !== (opts.provider !== undefined)) {
        fail(t, t.modelRefIncomplete());
        return;
      }
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const detail = await client.request<OrganizationDetail>(
        "POST",
        `/api/projects/${enc(projectId)}/organizations`,
        {
          orgId: String(opts.orgId),
          mission: String(opts.mission),
          ...(opts.name !== undefined ? { name: String(opts.name) } : {}),
          ...(opts.workspace !== undefined ? { workspace: String(opts.workspace) } : {}),
          ...(opts.modelId !== undefined
            ? { model: { provider: String(opts.provider), modelId: String(opts.modelId) } }
            : {}),
        },
      );
      if (opts.json === true) printJson(detail);
      else printLine(t.org.created(detail.orgId, detail.ceoDeskSessionId));
    });

  scoped(org.command("show").description(t.org.showDesc), t).action(async (opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const detail = await scope.client.request<OrganizationDetail>("GET", scope.base);
    if (opts.json === true) printJson(detail);
    else process.stdout.write(renderDetail(detail, t));
  });

  scoped(org.command("chart").description(t.org.chartDesc), t).action(async (opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const res = await scope.client.request<OrgChartResponse>("GET", `${scope.base}/chart`);
    if (opts.json === true) printJson(res);
    else process.stdout.write(renderChart(res, t));
  });

  // ---- employees ----

  scoped(
    org
      .command("hire")
      .description(t.org.hireDesc)
      .option("--agent-id <id>", t.org.hireAgentId)
      .option("--new-agent <id>", t.org.newAgent)
      .option("--name <name>", t.org.newAgentName)
      .option("--description <text>", t.org.newAgentDescription)
      .option("--skills <names>", t.org.skills)
      .requiredOption("--title <title>", t.org.title)
      .requiredOption("--reports-to <agent_id>", t.org.reportsTo)
      .option("--workspace <path>", t.org.employeeWorkspace)
      .option("--budget <usd>", t.org.budget)
      .option("--duties <text>", t.org.duties),
    t,
  ).action(async (opts) => {
    // The employee is an existing Agent XOR a new one; the new-Agent fields describe the latter.
    if ((opts.agentId !== undefined) === (opts.newAgent !== undefined)) {
      fail(t, t.org.hireTargetConflict());
      return;
    }
    if (
      opts.newAgent === undefined &&
      (opts.name !== undefined || opts.description !== undefined || opts.skills !== undefined)
    ) {
      fail(t, t.org.newAgentFieldsOnly());
      return;
    }
    const budget = opts.budget !== undefined ? parseBudget(String(opts.budget), t) : undefined;
    if (budget === null) return;
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const plugins = commaList(opts.skills);
    const item = await scope.client.request<OrgEmployeeItem>("POST", `${scope.base}/employees`, {
      ...(opts.agentId !== undefined ? { agentId: String(opts.agentId) } : {}),
      ...(opts.newAgent !== undefined
        ? {
            newAgent: {
              agentId: String(opts.newAgent),
              ...(opts.name !== undefined ? { name: String(opts.name) } : {}),
              ...(opts.description !== undefined ? { description: String(opts.description) } : {}),
              ...(plugins !== undefined ? { plugins } : {}),
            },
          }
        : {}),
      title: String(opts.title),
      reportsTo: String(opts.reportsTo),
      ...(opts.workspace !== undefined ? { workspace: String(opts.workspace) } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(opts.duties !== undefined ? { duties: String(opts.duties) } : {}),
    });
    if (opts.json === true) printJson(item);
    else printLine(t.org.hired(item.agentId, item.title, item.reportsTo));
  });

  const employee = org.command("employee").description(t.org.employeeDesc);

  scoped(
    employee
      .command("set <agent_id>")
      .description(t.org.employeeSetDesc)
      .option("--title <title>", t.org.title)
      .option("--reports-to <agent_id>", t.org.reportsTo)
      .option("--workspace <path>", t.org.employeeWorkspace)
      .option("--budget <usd>", t.org.budget)
      .option("--duties <text>", t.org.duties)
      .option("--model-id <id>", t.common.modelId)
      .option("--provider <group>", t.common.provider),
    t,
  ).action(async (agentId: string, opts) => {
    if (refuseDotSegments(agentId, t)) return;
    if (Boolean(opts.modelId) !== Boolean(opts.provider)) {
      fail(t, t.modelRefIncomplete());
      return;
    }
    const budget = opts.budget !== undefined ? parseBudget(String(opts.budget), t) : undefined;
    if (budget === null) return;
    const body = {
      ...(opts.title !== undefined ? { title: String(opts.title) } : {}),
      ...(opts.reportsTo !== undefined ? { reportsTo: String(opts.reportsTo) } : {}),
      ...(opts.workspace !== undefined ? { workspace: String(opts.workspace) } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(opts.duties !== undefined ? { duties: String(opts.duties) } : {}),
      ...(opts.modelId !== undefined
        ? { model: { provider: String(opts.provider), modelId: String(opts.modelId) } }
        : {}),
    };
    if (Object.keys(body).length === 0) {
      fail(t, t.org.nothingToSet());
      return;
    }
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const item = await scope.client.request<OrgEmployeeItem>(
      "PATCH",
      `${scope.base}/employees/${enc(agentId)}`,
      body,
    );
    if (opts.json === true) printJson(item);
    else printLine(t.org.employeeUpdated(item.agentId));
  });

  scoped(org.command("leave <agent_id>").description(t.org.leaveDesc), t).action(
    async (agentId: string, opts) => {
      if (refuseDotSegments(agentId, t)) return;
      const scope = await orgScope(opts, t);
      if (scope === null) return;
      await scope.client.request("DELETE", `${scope.base}/employees/${enc(agentId)}`);
      if (opts.json === true) printJson({ agentId });
      else printLine(t.org.left(agentId));
    },
  );

  // ---- desks ----

  const desk = org.command("desk").description(t.org.deskDesc);

  scoped(desk.command("show [agent_id]").description(t.org.deskShowDesc), t).action(
    async (agentArg: string | undefined, opts) => {
      const scope = await orgScope(opts, t);
      if (scope === null) return;
      const agentId = resolveAgentId(agentArg);
      const res = await scope.client.request<OrgDeskResponse>(
        "GET",
        `${scope.base}/employees/${enc(agentId)}/desk`,
      );
      if (opts.json === true) printJson(res);
      else {
        printLine(t.org.desk(res.agentId, res.sessionId, res.workspace, res.openedAt, res.created));
      }
    },
  );

  scoped(desk.command("renew [agent_id]").description(t.org.deskRenewDesc), t).action(
    async (agentArg: string | undefined, opts) => {
      const scope = await orgScope(opts, t);
      if (scope === null) return;
      const agentId = resolveAgentId(agentArg);
      const res = await scope.client.request<OrgDeskResponse>(
        "POST",
        `${scope.base}/employees/${enc(agentId)}/desk`,
      );
      if (opts.json === true) printJson(res);
      else printLine(t.org.deskRenewed(res.agentId, res.sessionId));
    },
  );

  // ---- calendar ----

  const calendar = org.command("calendar").description(t.org.calendarDesc);

  scoped(
    calendar
      .command("ls")
      .description(t.org.calendarLsDesc)
      .option("--agent-id <id>", t.org.calendarAgentId),
    t,
  ).action(async (opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const all = await scope.client.request<OrgCalendarResponse>("GET", `${scope.base}/calendar`);
    // Without --agent-id the whole organization's calendar; with it, that employee's events.
    const only = opts.agentId !== undefined ? resolveAgentId(opts.agentId) : undefined;
    const res: OrgCalendarResponse =
      only === undefined
        ? all
        : {
            events: all.events.filter((e) => e.agentId === only),
            invalidFiles: all.invalidFiles.filter((f) => f.agentId === only),
          };
    if (opts.json === true) {
      printJson(res);
      return;
    }
    const rows: string[][] = res.events.map((e) => [
      e.agentId,
      e.name,
      e.enabled ? t.schedule.enabled() : t.schedule.disabled(),
      e.startAt,
      e.period ?? t.schedule.oneShot(),
      e.nextFireAt ?? "-",
      e.lastFiredAt ?? "-",
      // Active is the quiet norm; a paused organization or employee skips due slots.
      e.status !== "active" ? e.status : e.paused ? "paused" : "",
    ]);
    for (const f of res.invalidFiles) {
      rows.push([f.agentId, f.name, "-", "-", "-", "-", "-", "invalid"]);
    }
    if (rows.length === 0) {
      printLine(t.org.calendarEmpty());
      return;
    }
    process.stdout.write(
      renderTable(
        [
          t.agent.colId(),
          t.schedule.colName(),
          t.schedule.colEnabled(),
          t.schedule.colStartAt(),
          t.schedule.colPeriod(),
          t.org.colNext(),
          t.schedule.colLastFired(),
          t.schedule.colStatus(),
        ],
        rows,
      ),
    );
  });

  scoped(
    calendar
      .command("add <name>")
      .description(t.org.calendarAddDesc)
      .option("--agent-id <id>", t.org.calendarAgentId)
      .requiredOption("--prompt <text>", t.schedule.prompt)
      .requiredOption("--start-at <when>", t.schedule.startAt)
      .option("--period <duration>", t.schedule.period)
      .option("--end-at <iso>", t.schedule.endAt)
      .option("--title <title>", t.org.calendarTitle)
      .option("--disabled", t.schedule.disabledOpt),
    t,
  ).action(async (name: string, opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const agentId = resolveAgentId(opts.agentId);
    const item = await scope.client.request<OrgCalendarItem>("POST", `${scope.base}/calendar`, {
      agentId,
      name,
      ...(opts.title !== undefined ? { title: String(opts.title) } : {}),
      prompt: String(opts.prompt),
      // As `schedule add`: an event added through the CLI is meant to fire; --disabled opts out.
      enabled: opts.disabled !== true,
      startAt: resolveStartAt(String(opts.startAt)),
      ...(opts.period !== undefined ? { period: String(opts.period) } : {}),
      ...(opts.endAt !== undefined ? { endAt: String(opts.endAt) } : {}),
    });
    if (opts.json === true) printJson(item);
    else printLine(calendarWrittenLine(t, item));
  });

  scoped(
    calendar
      .command("update <name>")
      .description(t.org.calendarUpdateDesc)
      .option("--agent-id <id>", t.org.calendarAgentId)
      .option("--prompt <text>", t.schedule.prompt)
      .option("--start-at <when>", t.schedule.startAt)
      .option("--period <duration>", t.schedule.period)
      .option("--end-at <iso>", t.schedule.endAt)
      .option("--title <title>", t.org.calendarTitle)
      .option("--enable", t.schedule.enableOpt)
      .option("--disable", t.schedule.disableOpt),
    t,
  ).action(async (name: string, opts) => {
    if (opts.enable === true && opts.disable === true) {
      fail(t, t.schedule.enableDisableConflict());
      return;
    }
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const agentId = resolveAgentId(opts.agentId);
    const target = `${scope.base}/calendar/${enc(agentId)}/${enc(name)}`;
    // Read-modify-write: unspecified fields keep the stored values.
    const stored = await scope.client.request<OrgCalendarItem>("GET", target);
    const body: Record<string, unknown> = {
      enabled: opts.enable === true ? true : opts.disable === true ? false : stored.enabled,
      prompt: opts.prompt !== undefined ? String(opts.prompt) : stored.prompt,
      startAt: opts.startAt !== undefined ? resolveStartAt(String(opts.startAt)) : stored.startAt,
    };
    const title = opts.title !== undefined ? String(opts.title) : stored.title;
    if (title !== undefined) body.title = title;
    const period = opts.period !== undefined ? String(opts.period) : stored.period;
    if (period !== undefined) body.period = period;
    const endAt = opts.endAt !== undefined ? String(opts.endAt) : stored.endAt;
    if (endAt !== undefined) body.endAt = endAt;
    const item = await scope.client.request<OrgCalendarItem>("PUT", target, body);
    if (opts.json === true) printJson(item);
    else printLine(calendarWrittenLine(t, item));
  });

  scoped(
    calendar
      .command("rm <name>")
      .description(t.org.calendarRmDesc)
      .option("--agent-id <id>", t.org.calendarAgentId),
    t,
  ).action(async (name: string, opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const agentId = resolveAgentId(opts.agentId);
    await scope.client.request("DELETE", `${scope.base}/calendar/${enc(agentId)}/${enc(name)}`);
    if (opts.json === true) printJson({ agentId, name });
    else printLine(t.org.calendarRemoved(agentId, name));
  });

  // ---- tickets ----

  const ticket = org.command("ticket").description(t.org.ticketDesc);

  scoped(
    ticket
      .command("ls")
      .description(t.org.ticketLsDesc)
      .option("--status <column>", t.org.statusFilter)
      .option("--owner <principal>", t.org.ownerFilter)
      .option("--blocked", t.org.blockedFilter),
    t,
  ).action(async (opts) => {
    const status = opts.status !== undefined ? parseColumn(String(opts.status), t) : undefined;
    if (status === null) return;
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const res = await scope.client.request<OrgTicketsResponse>("GET", `${scope.base}/tickets`);
    // The board comes whole; the filters are local, over every column in board order.
    const tickets: OrgTicketItem[] = TICKET_COLUMNS.flatMap((column) => res.columns[column]).filter(
      (item) =>
        (status === undefined || item.status === status) &&
        (opts.owner === undefined || item.owner === String(opts.owner)) &&
        (opts.blocked !== true || isBlocked(item)),
    );
    if (opts.json === true) {
      printJson({ tickets, invalidFiles: res.invalidFiles });
      return;
    }
    const rows: string[][] = tickets.map((item) => [
      item.ticketId,
      item.status,
      item.priority,
      item.owner ?? "-",
      isBlocked(item) ? "blocked" : "",
      String(item.sessions.length),
      item.title,
    ]);
    for (const f of res.invalidFiles) rows.push([f.path, "invalid", "-", "-", "", "-", f.error]);
    if (rows.length === 0) {
      printLine(t.org.ticketsEmpty());
      return;
    }
    process.stdout.write(
      renderTable(
        [
          t.agent.colId(),
          t.schedule.colStatus(),
          t.org.colPriority(),
          t.org.colOwner(),
          t.org.colBlocked(),
          t.agent.colSessions(),
          t.org.colTitle(),
        ],
        rows,
      ),
    );
  });

  scoped(ticket.command("show <ticket_id>").description(t.org.ticketShowDesc), t).action(
    async (ticketId: string, opts) => {
      const scope = await orgScope(opts, t);
      if (scope === null) return;
      const detail = await scope.client.request<OrgTicketDetail>(
        "GET",
        `${scope.base}/tickets/${enc(ticketId)}`,
      );
      if (opts.json === true) printJson(detail);
      else process.stdout.write(renderTicket(detail, t));
    },
  );

  scoped(
    ticket
      .command("create")
      .description(t.org.ticketCreateDesc)
      .requiredOption("--title <title>", t.org.ticketTitle)
      .option("--goal <text>", t.org.goal)
      .option("--criteria <text>", t.org.criteria)
      .option("--body-file <path>", t.org.bodyFile)
      .option("--owner <principal>", t.org.owner)
      .option("--parent <ticket_id>", t.org.parent)
      .option("--notify <principals>", t.org.notify)
      .option("--priority <level>", t.org.priority)
      .option("--due <date>", t.org.due),
    t,
  ).action(async (opts) => {
    // The content is --goal (with --criteria) XOR the whole Markdown body from a file.
    if ((opts.goal !== undefined) === (opts.bodyFile !== undefined)) {
      fail(t, t.org.ticketBodyConflict());
      return;
    }
    if (opts.criteria !== undefined && opts.goal === undefined) {
      fail(t, t.org.criteriaNeedsGoal());
      return;
    }
    const priority =
      opts.priority !== undefined ? parsePriority(String(opts.priority), t) : undefined;
    if (priority === null) return;
    let body: string | undefined;
    if (opts.bodyFile !== undefined) {
      try {
        body = fs.readFileSync(path.resolve(String(opts.bodyFile)), "utf8");
      } catch {
        fail(t, t.org.bodyFileUnreadable(String(opts.bodyFile)));
        return;
      }
    }
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const notify = commaList(opts.notify);
    const detail = await scope.client.request<OrgTicketDetail>("POST", `${scope.base}/tickets`, {
      title: String(opts.title),
      ...(opts.goal !== undefined ? { goal: String(opts.goal) } : {}),
      ...(opts.criteria !== undefined ? { acceptanceCriteria: String(opts.criteria) } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(opts.owner !== undefined ? { owner: String(opts.owner) } : {}),
      ...(opts.parent !== undefined ? { parent: String(opts.parent) } : {}),
      ...(notify !== undefined ? { notify } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(opts.due !== undefined ? { due: String(opts.due) } : {}),
      ...actorFields(),
    });
    if (opts.json === true) printJson(detail);
    else printLine(t.org.ticketCreated(detail.ticketId, detail.status));
  });

  scoped(
    ticket
      .command("move <ticket_id>")
      .description(t.org.ticketMoveDesc)
      .requiredOption("--to <column>", t.org.moveTo)
      .option("--reason <text>", t.org.moveReason),
    t,
  ).action(async (ticketId: string, opts) => {
    const status = parseColumn(String(opts.to), t);
    if (status === null) return;
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const detail = await scope.client.request<OrgTicketDetail>(
      "POST",
      `${scope.base}/tickets/${enc(ticketId)}/move`,
      {
        status,
        ...(opts.reason !== undefined ? { reason: String(opts.reason) } : {}),
        ...actorFields(),
      },
    );
    if (opts.json === true) printJson(detail);
    else printLine(t.org.ticketMoved(detail.ticketId, detail.status));
  });

  scoped(
    ticket
      .command("assign <ticket_id>")
      .description(t.org.ticketAssignDesc)
      .requiredOption("--owner <principal>", t.org.owner),
    t,
  ).action(async (ticketId: string, opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const detail = await scope.client.request<OrgTicketDetail>(
      "PUT",
      `${scope.base}/tickets/${enc(ticketId)}`,
      { owner: String(opts.owner), ...actorFields() },
    );
    if (opts.json === true) printJson(detail);
    else printLine(t.org.ticketAssigned(detail.ticketId, detail.owner ?? String(opts.owner)));
  });

  scoped(
    ticket
      .command("block <ticket_id>")
      .description(t.org.ticketBlockDesc)
      .requiredOption("--reason <text>", t.org.blockReason)
      .option("--by <principal|ticket_id>", t.org.blockedBy),
    t,
  ).action(async (ticketId: string, opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const detail = await scope.client.request<OrgTicketDetail>(
      "POST",
      `${scope.base}/tickets/${enc(ticketId)}/block`,
      {
        reason: String(opts.reason),
        ...(opts.by !== undefined ? { by: String(opts.by) } : {}),
        ...actorFields(),
      },
    );
    if (opts.json === true) printJson(detail);
    else printLine(t.org.ticketBlocked(detail.ticketId));
  });

  scoped(ticket.command("unblock <ticket_id>").description(t.org.ticketUnblockDesc), t).action(
    async (ticketId: string, opts) => {
      const scope = await orgScope(opts, t);
      if (scope === null) return;
      const detail = await scope.client.request<OrgTicketDetail>(
        "POST",
        `${scope.base}/tickets/${enc(ticketId)}/unblock`,
        { ...actorFields() },
      );
      if (opts.json === true) printJson(detail);
      else printLine(t.org.ticketUnblocked(detail.ticketId));
    },
  );

  scoped(
    ticket
      .command("progress <ticket_id>")
      .description(t.org.ticketProgressDesc)
      .requiredOption("-m, --message <text>", t.org.progressText),
    t,
  ).action(async (ticketId: string, opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const detail = await scope.client.request<OrgTicketDetail>(
      "POST",
      `${scope.base}/tickets/${enc(ticketId)}/progress`,
      { text: String(opts.message), ...actorFields() },
    );
    if (opts.json === true) printJson(detail);
    else printLine(t.org.progressRecorded(detail.ticketId));
  });

  scoped(
    ticket
      .command("start <ticket_id>")
      .description(t.org.ticketStartDesc)
      .option("-m, --message <text>", t.org.startMessage)
      .option("--workspace <path>", t.org.startWorkspace),
    t,
  ).action(async (ticketId: string, opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    // Inside a session the ticket session runs as the calling employee; outside one the
    // server picks the ticket's owner — so the plain default_agent fallback is not applied.
    const agentId = process.env.PENGUIN_AGENT_ID?.trim() || undefined;
    const res = await scope.client.request<OrgTicketStartResponse>(
      "POST",
      `${scope.base}/tickets/${enc(ticketId)}/start`,
      {
        ...(agentId !== undefined ? { agentId } : {}),
        ...(opts.message !== undefined ? { message: String(opts.message) } : {}),
        ...(opts.workspace !== undefined ? { workspace: String(opts.workspace) } : {}),
      },
    );
    // Like `run --background`: the bare session id is what `penguin input` / `penguin logs` address later.
    if (opts.json === true) printJson({ sessionId: res.sessionId });
    else printLine(res.sessionId);
  });

  scoped(
    ticket
      .command("attach <ticket_id>")
      .description(t.org.ticketAttachDesc)
      .option("--session <session_id>", t.org.attachSession),
    t,
  ).action(async (ticketId: string, opts) => {
    const ref = opts.session !== undefined ? String(opts.session) : callerSessionId();
    if (ref === undefined) {
      fail(t, t.org.attachSessionMissing());
      return;
    }
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const sessionId = await resolveSessionRef(scope.client, scope.projectId, ref, t);
    const detail = await scope.client.request<OrgTicketDetail>(
      "POST",
      `${scope.base}/tickets/${enc(ticketId)}/attach`,
      { sessionId },
    );
    if (opts.json === true) printJson(detail);
    else printLine(t.org.ticketAttached(detail.ticketId, sessionId));
  });

  // ---- chat ----

  const chat = org.command("chat").description(t.org.chatDesc);

  scoped(
    chat
      .command("tail")
      .description(t.org.chatTailDesc)
      .option("--date <date>", t.org.chatDate)
      .option("-n, --count <count>", t.org.chatCount),
    t,
  ).action(async (opts) => {
    const count = opts.count !== undefined ? parseCount(String(opts.count), t) : DEFAULT_CHAT_COUNT;
    if (count === null) return;
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const qs = opts.date !== undefined ? `?date=${enc(String(opts.date))}` : "";
    const res = await scope.client.request<OrgChatResponse>("GET", `${scope.base}/chat${qs}`);
    const messages = res.messages.slice(-count);
    if (opts.json === true) {
      printJson({ ...res, messages });
      return;
    }
    if (messages.length === 0) {
      printLine(t.org.chatEmpty(res.date));
      return;
    }
    process.stdout.write(`${messages.map(chatLine).join("\n")}\n`);
  });

  scoped(
    chat
      .command("send")
      .description(t.org.chatSendDesc)
      .requiredOption("-m, --message <text>", t.org.chatText)
      .option("--ref-ticket <ticket_id>", t.org.refTicket)
      .option("--ref-session <session_id>", t.org.refSession),
    t,
  ).action(async (opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const refs = {
      ...(opts.refTicket !== undefined ? { ticket: String(opts.refTicket) } : {}),
      ...(opts.refSession !== undefined ? { session: String(opts.refSession) } : {}),
    };
    const msg = await scope.client.request<OrgChatMessage>("POST", `${scope.base}/chat`, {
      text: String(opts.message),
      ...(Object.keys(refs).length > 0 ? { refs } : {}),
      ...actorFields(),
    });
    if (opts.json === true) printJson(msg);
    else printLine(t.org.chatSent(msg.id));
  });

  // ---- handbook ----

  const handbook = org.command("handbook").description(t.org.handbookDesc);
  /** A handbook path keeps its `/` separators; each segment is encoded on its own. */
  const encPath = (rel: string): string => rel.split("/").map(enc).join("/");

  scoped(handbook.command("list").description(t.org.handbookListDesc), t).action(async (opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const res = await scope.client.request<OrgHandbookFilesResponse>(
      "GET",
      `${scope.base}/handbook/files`,
    );
    if (opts.json === true) {
      printJson(res);
      return;
    }
    process.stdout.write(
      `${res.files.map((f) => `${f.path}\t${f.size}\t${f.updatedAt}`).join("\n")}\n`,
    );
  });

  scoped(
    handbook
      .command("show")
      .description(t.org.handbookShowDesc)
      .argument("[path]", t.org.handbookPath),
    t,
  ).action(async (relArg: string | undefined, opts) => {
    const rel = relArg ?? "README.md";
    if (refuseDotSegments(rel, t)) return;
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const res = await scope.client.request<OrgHandbookFileResponse>(
      "GET",
      `${scope.base}/handbook/files/${encPath(rel)}`,
    );
    if (opts.json === true) printJson(res);
    else process.stdout.write(res.content.endsWith("\n") ? res.content : `${res.content}\n`);
  });

  scoped(
    handbook
      .command("write")
      .description(t.org.handbookWriteDesc)
      .argument("<path>", t.org.handbookPath)
      .option("-m, --message <text>", t.org.handbookText)
      .option("--file <file>", t.org.handbookFile),
    t,
  ).action(async (rel: string, opts) => {
    if (refuseDotSegments(rel, t)) return;
    if ((opts.message === undefined) === (opts.file === undefined)) {
      fail(t, t.org.handbookOneSource);
      return;
    }
    const content =
      opts.file !== undefined ? fs.readFileSync(String(opts.file), "utf8") : String(opts.message);
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const res = await scope.client.request<OrgHandbookFileResponse>(
      "PUT",
      `${scope.base}/handbook/files/${encPath(rel)}`,
      { content },
    );
    if (opts.json === true) printJson(res);
    else printLine(t.org.handbookWritten(res.path));
  });

  scoped(
    handbook.command("rm").description(t.org.handbookRmDesc).argument("<path>", t.org.handbookPath),
    t,
  ).action(async (rel: string, opts) => {
    if (refuseDotSegments(rel, t)) return;
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    await scope.client.request("DELETE", `${scope.base}/handbook/files/${encPath(rel)}`);
    if (opts.json === true) printJson({ ok: true, path: rel });
    else printLine(t.org.handbookRemoved(rel));
  });

  // ---- finance ----

  scoped(
    org
      .command("finance")
      .description(t.org.financeDesc)
      .option("--period <yyyy-mm>", t.org.period),
    t,
  ).action(async (opts) => {
    const scope = await orgScope(opts, t);
    if (scope === null) return;
    const qs = opts.period !== undefined ? `?period=${enc(String(opts.period))}` : "";
    const res = await scope.client.request<OrgFinanceResponse>("GET", `${scope.base}/finance${qs}`);
    if (opts.json === true) {
      printJson(res);
      return;
    }
    process.stdout.write(renderFinance(res, t));
    // Tokens were counted but some model had no pricing: the figures are a lower bound.
    if (res.unpriced) process.stderr.write(`${t.org.unpriced()}\n`);
  });
}

/** One line confirming a written calendar event (employee, name, enabled state, next fire when known). */
function calendarWrittenLine(t: Messages, item: OrgCalendarItem): string {
  return t.org.calendarWritten(
    item.agentId,
    item.name,
    item.enabled ? t.schedule.enabled() : t.schedule.disabled(),
    item.nextFireAt,
  );
}
