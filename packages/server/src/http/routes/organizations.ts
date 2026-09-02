/**
 * Company-mode routes, nested under a Project:
 *   GET|POST      /api/projects/:p/organizations
 *   GET|PATCH|DELETE /api/projects/:p/organizations/:orgId
 *   GET           …/:orgId/chart
 *   POST          …/:orgId/employees                        # hire
 *   PATCH|DELETE  …/:orgId/employees/:agentId
 *   GET|POST      …/:orgId/employees/:agentId/desk           # the desk session (GET opens it if needed; POST renews)
 *   GET|PUT       …/:orgId/handbook
 *   GET|POST      …/:orgId/calendar ; GET|PUT|DELETE …/:orgId/calendar/:agentId/:name
 *   GET|POST      …/:orgId/tickets ; GET|PUT …/:orgId/tickets/:ticketId
 *   POST          …/:orgId/tickets/:ticketId/(move|block|unblock|progress|start|attach)
 *   GET|POST      …/:orgId/chat ; POST …/:orgId/chat/read
 *   GET           …/:orgId/finance ; GET …/:orgId/sessions
 *
 * Authorization is the Project's: any member reads and writes (tickets, chat, calendar, the
 * tree, the handbook) and creates organizations, like creating an Agent; deleting one is the
 * owner's. Every route answers 404 while the admin master switch is off. A write carries the
 * caller's session id when it comes from inside a session (the CLI's control environment), so
 * the file records the employee rather than the token's user.
 */
import { Hono } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type {
  OrgApprovalMode,
  OrgStatus,
  OrgTicketPriority,
  OrgTicketStatus,
  OrganizationsResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { TICKET_ID_PATTERN } from "../../organization/files.js";
import { ORG_TICKET_COLUMNS } from "../../organization/paths.js";
import type { Actor } from "../../runtime/organization/service.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  optionalStringArray,
  readJson,
  requireEnum,
  requireString,
  requireValidId,
} from "../validate.js";

const STATUSES: readonly OrgStatus[] = ["active", "paused"];
const APPROVAL_MODES: readonly OrgApprovalMode[] = ["allow-all", "read-only", "deny-all"];
const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];

function requireTicketId(raw: string | undefined): string {
  if (!raw || !TICKET_ID_PATTERN.test(raw)) throw badRequest("Invalid ticket id.");
  return raw;
}

function requireName(raw: string | undefined, label: string): string {
  if (!raw || !isValidId(raw)) throw badRequest(`Invalid ${label}.`);
  return raw;
}

/** A nullable optional string field: absent → undefined, null → null (clear), string → validated. */
function nullableString(
  body: Record<string, unknown>,
  key: string,
  rule: { maxLen?: number } = {},
): string | null | undefined {
  if (body[key] === null) return null;
  return optionalString(body, key, { minLen: 1, maxLen: rule.maxLen ?? 200 });
}

function actorOf(c: { var: { user: { userId: string } } }, body: Record<string, unknown>): Actor {
  const sessionId = optionalString(body, "sessionId", { minLen: 1, maxLen: 200 });
  return { userId: c.var.user.userId, ...(sessionId !== undefined ? { sessionId } : {}) };
}

export function organizationRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!deps.serverSettingsRepo.getCompanyMode()) {
      throw new HttpError(404, "company_mode_off", "Company mode is turned off on this server.");
    }
    await next();
  });

  const member = (c: { var: { user: { userId: string } } }, projectId: string): void => {
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
  };

  // ---- organizations ----

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    member(c, projectId);
    const res: OrganizationsResponse = { organizations: await deps.orgService.list(projectId) };
    return c.json(res);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    member(c, projectId);
    const body = await readJson(c);
    const orgId = requireString(body, "orgId", { minLen: 2, maxLen: 64 });
    const mission = requireString(body, "mission", { minLen: 1, maxLen: 4000 });
    const name = optionalString(body, "name", { minLen: 1, maxLen: 100 });
    const timezone = optionalString(body, "timezone", { minLen: 1, maxLen: 64 });
    const detail = await deps.orgService.create(
      projectId,
      {
        orgId,
        mission,
        ...(name !== undefined ? { name } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
      },
      c.var.user.userId,
    );
    return c.json(detail, 201);
  });

  app.get("/:orgId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    return c.json(await deps.orgService.detail(projectId, orgId, c.var.user.userId));
  });

  app.patch("/:orgId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const name = optionalString(body, "name", { minLen: 1, maxLen: 100 });
    const mission = optionalString(body, "mission", { minLen: 1, maxLen: 4000 });
    const status = optionalEnum(body, "status", STATUSES);
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    const timezone = optionalString(body, "timezone", { minLen: 1, maxLen: 64 });
    const mentionChainLimit = optionalNumber(body, "mentionChainLimit", {
      integer: true,
      nonNegative: true,
    });
    const budgetWarnRatio = optionalNumber(body, "budgetWarnRatio", { nonNegative: true });
    const budgetPauseRatio = optionalNumber(body, "budgetPauseRatio", { nonNegative: true });
    const settings = await deps.orgService.patch(projectId, orgId, {
      ...(name !== undefined ? { name } : {}),
      ...(mission !== undefined ? { mission } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(approvalMode !== undefined ? { approvalMode } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(mentionChainLimit !== undefined ? { mentionChainLimit } : {}),
      ...(budgetWarnRatio !== undefined ? { budgetWarnRatio } : {}),
      ...(budgetPauseRatio !== undefined ? { budgetPauseRatio } : {}),
    });
    return c.json(settings);
  });

  app.delete("/:orgId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    await deps.orgService.remove(projectId, orgId);
    return c.body(null, 204);
  });

  // ---- employees ----

  app.get("/:orgId/chart", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    return c.json(await deps.orgService.chart(projectId, orgId));
  });

  app.post("/:orgId/employees", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const agentId = optionalString(body, "agentId", { minLen: 2, maxLen: 64 });
    let newAgent:
      { agentId: string; name?: string; description?: string; plugins?: string[] } | undefined;
    if (body.newAgent !== undefined) {
      if (body.newAgent === null || typeof body.newAgent !== "object")
        throw badRequest("newAgent must be an object.");
      const n = body.newAgent as Record<string, unknown>;
      const id = requireString(n, "agentId", { minLen: 2, maxLen: 64, label: "newAgent.agentId" });
      const name = optionalString(n, "name", { minLen: 1, maxLen: 100, label: "newAgent.name" });
      const description = optionalString(n, "description", {
        maxLen: 2000,
        label: "newAgent.description",
      });
      const plugins = optionalStringArray(n, "plugins", "newAgent.plugins");
      newAgent = {
        agentId: id,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(plugins !== undefined ? { plugins } : {}),
      };
    }
    const title = requireString(body, "title", { minLen: 1, maxLen: 100 });
    const reportsTo = requireString(body, "reportsTo", { minLen: 2, maxLen: 64 });
    const workspace = optionalString(body, "workspace", { minLen: 1, maxLen: 4096 });
    const budget = optionalNumber(body, "budget", { nonNegative: true });
    const duties = optionalString(body, "duties", { maxLen: 2000 });
    const model = parseModel(body);
    const item = await deps.orgService.hire(projectId, orgId, {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(newAgent !== undefined ? { newAgent } : {}),
      title,
      reportsTo,
      ...(workspace !== undefined ? { workspace } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(duties !== undefined ? { duties } : {}),
      ...(model !== undefined && model !== null ? { model } : {}),
    });
    return c.json(item, 201);
  });

  app.patch("/:orgId/employees/:agentId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    member(c, projectId);
    const body = await readJson(c);
    const title = optionalString(body, "title", { minLen: 1, maxLen: 100 });
    const reportsTo = optionalString(body, "reportsTo", { minLen: 2, maxLen: 64 });
    const workspace = optionalString(body, "workspace", { minLen: 1, maxLen: 4096 });
    const budget =
      body.budget === null ? null : optionalNumber(body, "budget", { nonNegative: true });
    const duties = optionalString(body, "duties", { maxLen: 2000 });
    const model = parseModel(body);
    const item = await deps.orgService.patchEmployee(projectId, orgId, agentId, {
      ...(title !== undefined ? { title } : {}),
      ...(reportsTo !== undefined ? { reportsTo } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(duties !== undefined ? { duties } : {}),
      ...(model !== undefined ? { model } : {}),
    });
    return c.json(item);
  });

  app.delete("/:orgId/employees/:agentId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    member(c, projectId);
    await deps.orgService.leave(projectId, orgId, agentId);
    return c.body(null, 204);
  });

  app.get("/:orgId/employees/:agentId/desk", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    member(c, projectId);
    return c.json(await deps.orgService.desk(projectId, orgId, agentId, {}));
  });

  app.post("/:orgId/employees/:agentId/desk", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    member(c, projectId);
    return c.json(await deps.orgService.desk(projectId, orgId, agentId, { renew: true }), 201);
  });

  // ---- handbook ----

  app.get("/:orgId/handbook", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    return c.json({ content: await deps.orgService.handbook(projectId, orgId) });
  });

  app.put("/:orgId/handbook", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const content = requireString(body, "content", { maxLen: 200_000 });
    await deps.orgService.writeHandbook(projectId, orgId, content);
    return c.json({ content });
  });

  // ---- calendar ----

  const calendarFields = (body: Record<string, unknown>) => {
    if (typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean.");
    const title = optionalString(body, "title", { minLen: 1, maxLen: 200 });
    const period = optionalString(body, "period", { minLen: 1, maxLen: 20 });
    const endAt = optionalString(body, "endAt", { minLen: 1, maxLen: 100 });
    return {
      ...(title !== undefined ? { title } : {}),
      prompt: requireString(body, "prompt", { minLen: 1, maxLen: 100_000 }),
      enabled: body.enabled,
      startAt: requireString(body, "startAt", { minLen: 1, maxLen: 100 }),
      ...(period !== undefined ? { period } : {}),
      ...(endAt !== undefined ? { endAt } : {}),
    };
  };

  app.get("/:orgId/calendar", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    return c.json(await deps.orgService.calendar(projectId, orgId));
  });

  app.post("/:orgId/calendar", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const agentId = requireName(
      requireString(body, "agentId", { minLen: 2, maxLen: 64 }),
      "agentId",
    );
    const name = requireName(requireString(body, "name", { minLen: 1, maxLen: 100 }), "name");
    const item = await deps.orgService.upsertCalendar(
      projectId,
      orgId,
      agentId,
      name,
      calendarFields(body),
      {
        create: true,
      },
    );
    return c.json(item, 201);
  });

  app.get("/:orgId/calendar/:agentId/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    const name = requireName(c.req.param("name"), "name");
    member(c, projectId);
    const list = await deps.orgService.calendar(projectId, orgId);
    const item = list.events.find((e) => e.agentId === agentId && e.name === name);
    if (!item)
      throw new HttpError(
        404,
        "calendar_event_not_found",
        `Calendar event does not exist: ${agentId}/${name}`,
      );
    return c.json(item);
  });

  app.put("/:orgId/calendar/:agentId/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    const name = requireName(c.req.param("name"), "name");
    member(c, projectId);
    const body = await readJson(c);
    return c.json(
      await deps.orgService.upsertCalendar(projectId, orgId, agentId, name, calendarFields(body), {
        create: false,
      }),
    );
  });

  app.delete("/:orgId/calendar/:agentId/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const agentId = requireValidId(c, "agentId");
    const name = requireName(c.req.param("name"), "name");
    member(c, projectId);
    await deps.orgService.deleteCalendar(projectId, orgId, agentId, name);
    return c.body(null, 204);
  });

  // ---- tickets ----

  app.get("/:orgId/tickets", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    return c.json(await deps.orgService.tickets(projectId, orgId));
  });

  app.post("/:orgId/tickets", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const title = requireString(body, "title", { minLen: 1, maxLen: 200 });
    const slug = optionalString(body, "slug", { minLen: 1, maxLen: 64 });
    const goal = optionalString(body, "goal", { maxLen: 100_000 });
    const acceptanceCriteria = optionalString(body, "acceptanceCriteria", { maxLen: 100_000 });
    const text = optionalString(body, "body", { maxLen: 200_000 });
    const owner = optionalString(body, "owner", { maxLen: 100 });
    const parent = optionalString(body, "parent", { minLen: 1, maxLen: 100 });
    const notify = optionalStringArray(body, "notify");
    const priority = optionalEnum(body, "priority", PRIORITIES);
    const due = optionalString(body, "due", { minLen: 10, maxLen: 40 });
    const detail = await deps.orgService.createTicket(
      projectId,
      orgId,
      {
        title,
        ...(slug !== undefined ? { slug } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
        ...(text !== undefined ? { body: text } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(parent !== undefined ? { parent: requireTicketId(parent) } : {}),
        ...(notify !== undefined ? { notify } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(due !== undefined ? { due } : {}),
      },
      actorOf(c, body),
    );
    return c.json(detail, 201);
  });

  app.get("/:orgId/tickets/:ticketId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    return c.json(await deps.orgService.ticket(projectId, orgId, ticketId));
  });

  app.put("/:orgId/tickets/:ticketId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c);
    const title = optionalString(body, "title", { minLen: 1, maxLen: 200 });
    const owner = nullableString(body, "owner", { maxLen: 100 });
    const parent = nullableString(body, "parent", { maxLen: 100 });
    const notify = optionalStringArray(body, "notify");
    const priority = optionalEnum(body, "priority", PRIORITIES);
    const due = nullableString(body, "due", { maxLen: 40 });
    const goal = optionalString(body, "goal", { maxLen: 100_000 });
    const acceptanceCriteria = optionalString(body, "acceptanceCriteria", { maxLen: 100_000 });
    const result = optionalString(body, "result", { maxLen: 100_000 });
    const detail = await deps.orgService.updateTicket(
      projectId,
      orgId,
      ticketId,
      {
        ...(title !== undefined ? { title } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(parent !== undefined
          ? { parent: parent === null ? null : requireTicketId(parent) }
          : {}),
        ...(notify !== undefined ? { notify } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(due !== undefined ? { due } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
        ...(result !== undefined ? { result } : {}),
      },
      actorOf(c, body),
    );
    return c.json(detail);
  });

  app.post("/:orgId/tickets/:ticketId/move", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c);
    const status = requireEnum(body, "status", ORG_TICKET_COLUMNS as readonly OrgTicketStatus[]);
    const reason = optionalString(body, "reason", { maxLen: 4000 });
    return c.json(
      await deps.orgService.moveTicket(
        projectId,
        orgId,
        ticketId,
        status,
        reason,
        actorOf(c, body),
      ),
    );
  });

  app.post("/:orgId/tickets/:ticketId/block", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c);
    const reason = requireString(body, "reason", { minLen: 1, maxLen: 2000 });
    const by = optionalString(body, "by", { minLen: 1, maxLen: 100 });
    return c.json(
      await deps.orgService.blockTicket(projectId, orgId, ticketId, reason, by, actorOf(c, body)),
    );
  });

  app.post("/:orgId/tickets/:ticketId/unblock", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await deps.orgService.unblockTicket(projectId, orgId, ticketId, actorOf(c, body)),
    );
  });

  app.post("/:orgId/tickets/:ticketId/progress", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c);
    const text = requireString(body, "text", { minLen: 1, maxLen: 4000 });
    return c.json(
      await deps.orgService.progressTicket(projectId, orgId, ticketId, text, actorOf(c, body)),
    );
  });

  app.post("/:orgId/tickets/:ticketId/start", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c).catch(() => ({}) as Record<string, unknown>);
    const agentId = optionalString(body, "agentId", { minLen: 2, maxLen: 64 });
    const message = optionalString(body, "message", { maxLen: 100_000 });
    const workspace = optionalString(body, "workspace", { minLen: 1, maxLen: 4096 });
    const res = await deps.orgService.startTicket(projectId, orgId, ticketId, {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
    });
    return c.json(res, 202);
  });

  app.post("/:orgId/tickets/:ticketId/attach", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    const ticketId = requireTicketId(c.req.param("ticketId"));
    member(c, projectId);
    const body = await readJson(c);
    const sessionId = requireString(body, "sessionId", { minLen: 1, maxLen: 200 });
    return c.json(
      await deps.orgService.attachTicket(projectId, orgId, ticketId, sessionId, actorOf(c, body)),
    );
  });

  // ---- chat ----

  app.get("/:orgId/chat", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const date = c.req.query("date");
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw badRequest("date must be yyyy-mm-dd.");
    return c.json(
      await deps.orgService.chat(projectId, orgId, c.var.user.userId, {
        ...(date !== undefined ? { date } : {}),
      }),
    );
  });

  app.post("/:orgId/chat", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const text = requireString(body, "text", { minLen: 1, maxLen: 20_000 });
    const sessionId = optionalString(body, "sessionId", { minLen: 1, maxLen: 200 });
    let refs: { ticket?: string; session?: string; replyTo?: string } | undefined;
    if (body.refs !== undefined && body.refs !== null) {
      if (typeof body.refs !== "object") throw badRequest("refs must be an object.");
      const r = body.refs as Record<string, unknown>;
      const ticket = optionalString(r, "ticket", { minLen: 1, maxLen: 100, label: "refs.ticket" });
      const session = optionalString(r, "session", {
        minLen: 1,
        maxLen: 200,
        label: "refs.session",
      });
      const replyTo = optionalString(r, "replyTo", {
        minLen: 1,
        maxLen: 100,
        label: "refs.replyTo",
      });
      refs = {
        ...(ticket !== undefined ? { ticket } : {}),
        ...(session !== undefined ? { session } : {}),
        ...(replyTo !== undefined ? { replyTo } : {}),
      };
    }
    const msg = await deps.orgService.sendChat(projectId, orgId, c.var.user.userId, {
      text,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(refs !== undefined ? { refs } : {}),
    });
    return c.json(msg, 201);
  });

  app.post("/:orgId/chat/read", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const body = await readJson(c);
    const upTo = requireString(body, "upTo", { minLen: 1, maxLen: 100 });
    await deps.orgService.markRead(projectId, orgId, c.var.user.userId, upTo);
    return c.body(null, 204);
  });

  // ---- finance and sessions ----

  app.get("/:orgId/finance", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    const period = c.req.query("period");
    if (period !== undefined && !/^\d{4}-\d{2}$/.test(period))
      throw badRequest("period must be yyyy-mm.");
    return c.json(await deps.orgService.finance(projectId, orgId, period));
  });

  app.get("/:orgId/sessions", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const orgId = requireValidId(c, "orgId");
    member(c, projectId);
    return c.json(await deps.orgService.sessions(projectId, orgId));
  });

  return app;
}

/** `model: { provider, modelId }` or `model: null` (clear); undefined when absent. */
function parseModel(
  body: Record<string, unknown>,
): { provider: string; modelId: string } | null | undefined {
  if (body.model === undefined) return undefined;
  if (body.model === null) return null;
  if (typeof body.model !== "object") throw badRequest("model must be an object or null.");
  const m = body.model as Record<string, unknown>;
  return {
    provider: requireString(m, "provider", { minLen: 1, maxLen: 64, label: "model.provider" }),
    modelId: requireString(m, "modelId", { minLen: 1, maxLen: 200, label: "model.modelId" }),
  };
}

export { optionalBoolean };
