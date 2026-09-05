/**
 * A company-mode harness on doubles: the real file store, caches and service, with the
 * session manager, session creation, the Agent lifecycle and usage pricing replaced by
 * recording fakes and the clock under test control. Shared by the runtime and scenario
 * suites so both exercise the same seams the app binds in production.
 */
import { saveProjectConfig } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { ServerEvent } from "../src/api/types.js";
import { openDatabase } from "../src/db/database.js";
import { MembersRepo } from "../src/db/repos/members.js";
import { OrgCacheRepo } from "../src/db/repos/organizations.js";
import { ProjectsRepo } from "../src/db/repos/projects.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { UsersRepo } from "../src/db/repos/users.js";
import { OrgStore } from "../src/organization/store.js";
import type { ErrorRecordArgs } from "../src/runtime/error-recorder.js";
import type { OrgDeps } from "../src/runtime/organization/deps.js";
import { OrganizationScheduler } from "../src/runtime/organization/scheduler.js";
import { OrganizationService } from "../src/runtime/organization/service.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import { makeTempRoot } from "./helpers.js";

export interface StartedTask {
  sessionId: string;
  text: string;
  queueIfBusy: boolean;
}

export interface OrgHarness {
  root: string;
  projectId: string;
  store: OrgStore;
  cache: OrgCacheRepo;
  sessions: SessionsRepo;
  service: OrganizationService;
  scheduler: OrganizationScheduler;
  /** The controlled clock; assign to move time. */
  clock: { nowMs: number };
  /** Sessions currently reported as running by the fake manager. */
  busy: Set<string>;
  /** Every Task the runtime started, in order. */
  started: StartedTask[];
  /** Every session the fake creator opened. */
  created: Array<{ projectId: string; agentId: string; workspace?: string }>;
  /** Agents the fake lifecycle created, with their plugin seeds. */
  agentsCreated: Array<{ agentId: string; plugins: readonly string[] }>;
  /** AGENTS.md text written per Agent. */
  briefs: Map<string, string>;
  /** Cost per session the fake pricing reports. */
  costs: Map<string, number>;
  events: ServerEvent[];
  errors: ErrorRecordArgs[];
  /** The admin master switch. */
  flags: { companyMode: boolean };
}

function textOf(input: OmniMessage[]): string {
  const first = input[0] as { payload?: { text?: string } } | undefined;
  return first?.payload?.text ?? "";
}

export async function makeOrgHarness(opts: {
  projectId?: string;
  ownerUserId?: string;
  nowMs: number;
}): Promise<OrgHarness> {
  const projectId = opts.projectId ?? "p1";
  const owner = opts.ownerUserId ?? "alice";
  const root = await makeTempRoot();
  await saveProjectConfig(root, projectId, {
    default_model: { provider: "custom", model_id: "m-bench" },
    models: [{ provider: "custom", model_id: "m-bench" }],
  });
  const db = openDatabase(":memory:");
  new UsersRepo(db).insert({
    userId: owner,
    passwordHash: "x",
    isAdmin: false,
    passwordIsInitial: false,
    createdAt: "2026-08-01T00:00:00Z",
  });
  const projects = new ProjectsRepo(db);
  projects.insert({ projectId, ownerUserId: owner, createdAt: "2026-08-01T00:00:00Z" });
  const sessions = new SessionsRepo(db);
  const cache = new OrgCacheRepo(db);
  const store = new OrgStore(root);
  const clock = { nowMs: opts.nowMs };
  const busy = new Set<string>();
  const started: StartedTask[] = [];
  const created: OrgHarness["created"] = [];
  const agentsCreated: OrgHarness["agentsCreated"] = [];
  const briefs = new Map<string, string>();
  const costs = new Map<string, number>();
  const events: ServerEvent[] = [];
  const errors: ErrorRecordArgs[] = [];
  const flags = { companyMode: true };
  const existingAgents = new Set<string>();
  let seq = 0;
  const deps: OrgDeps = {
    root,
    store,
    cache,
    projects,
    members: new MembersRepo(db),
    sessions,
    runner: {
      statusOf: (id) => (busy.has(id) ? "running" : "idle"),
      startTask: async (sessionId, input, o) => {
        started.push({ sessionId, text: textOf(input), queueIfBusy: o?.queueIfBusy === true });
        return { sessionId, queued: busy.has(sessionId) };
      },
    },
    sessionCreator: {
      createSession: async (args) => {
        seq++;
        const sessionId = `session-2026-09-01-00-00-${String(seq).padStart(2, "0")}-${String(seq).padStart(8, "0")}`;
        created.push({
          projectId: args.projectId,
          agentId: args.agentId,
          ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
        });
        const createdAt = new Date(clock.nowMs).toISOString();
        sessions.insert({
          sessionId,
          projectId: args.projectId,
          agentId: args.agentId,
          provider: args.provider ?? "custom",
          modelId: args.modelId ?? "m-bench",
          workspace: args.workspace ?? root,
          approvalMode: args.approvalMode ?? "allow-all",
          title: null,
          client: "web",
          lastActiveAt: createdAt,
          createdAt,
        });
        return { sessionId, workspace: args.workspace ?? root };
      },
    },
    agents: {
      exists: async (_p, agentId) => existingAgents.has(agentId),
      create: async (_p, agentId, _name, _description, plugins) => {
        existingAgents.add(agentId);
        agentsCreated.push({ agentId, plugins });
      },
      displayName: async (_p, agentId) => `Name of ${agentId}`,
      writeAgentsMd: async (_p, agentId, content) => {
        briefs.set(agentId, content);
      },
    },
    projectConfig: new ProjectConfigService(root),
    usage: {
      costBySession: async (_p, ids) => ({
        bySession: new Map(ids.filter((id) => costs.has(id)).map((id) => [id, costs.get(id)!])),
        unpriced: false,
      }),
      dailyCostForSessions: async () => [],
    },
    errors: { record: (e) => void errors.push(e) },
    notifyProject: (_p, event) => void events.push(event),
    companyModeEnabled: () => flags.companyMode,
    now: () => clock.nowMs,
    log: () => {},
  };
  const scheduler = new OrganizationScheduler(deps, { intervalMs: 1_000_000 });
  const service = new OrganizationService(deps, scheduler);
  return {
    root,
    projectId,
    store,
    cache,
    sessions,
    service,
    scheduler,
    clock,
    busy,
    started,
    created,
    agentsCreated,
    briefs,
    costs,
    events,
    errors,
    flags,
  };
}
