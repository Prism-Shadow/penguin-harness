/**
 * The roadmap state machine, the room relay and the desk deliveries.
 *
 * A roadmap is opened by a person or an employee over an organization channel (its room) with one
 * or more employees, the first of whom moderates. For every employee in the room the relay
 * opens a room session — the employee's desk cloned for this discussion — through the
 * organization gateway, and puts every later room message into those sessions through the
 * session runtime — steered into the Task a session is running, else started as its next
 * one: the room reaches the clones, never the desks, and an organization that runs on another
 * machine is relayed there, not from its mirror here. The moderator
 * keeps the draft (a record, a body written as a paper, items that are only briefs); nothing
 * is created while the room discusses. Establishing ends the discussion; a proposal item
 * waits there as a brief until a person and the moderator approve it, and the second approval
 * creates its proposal through company-proposals (its owner the author), links it and tells
 * the owner the number — stacked on the previous proposal item unless it says otherwise. A
 * roadmap item becomes a derived roadmap waiting for its room. An owner who finds the roadmap
 * lacking reopens it, and the room discusses again.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { userText } from "@prismshadow/penguin-core/omnimessage";
import type {
  Log,
  MessagingTaskRunner,
  OrgActor,
  OrgGateway,
  OrgView,
  PluginConfig,
  SessionIndex,
} from "@prismshadow/penguin-server/plugin";
import { RetiredOrgs } from "./org-retire.js";
import { CONFIG_GROUP, configOf, type RoadmapConfig } from "./config.js";
import { proposalOfApproval, type ProposalCreator } from "./proposals.js";
import {
  RoadmapError,
  orgDirOf,
  type DraftItem,
  type ProposalItem,
  type Roadmap,
  type RoadmapStatus,
  type RoadmapWrite,
} from "./domain.js";
import {
  approvalRole,
  defaultAct,
  moderatorOf,
  verdictRoles,
  type Caller,
  type WriteAct,
} from "./guards.js";
import type { Subject } from "./action-shapes.js";
import type { RoadmapStore } from "./ports.js";
import { COMPANY_DB, companyDbPath } from "./schema.js";
import { SqliteRoadmapStore } from "./store.js";
import {
  baseLinkedLine,
  cloneBrief,
  approvalRequestLine,
  approvedLine,
  relayLine,
  reopenLine,
  roomJoinedLine,
  roomOpenedLine,
  roomRequestLine,
} from "./lines.js";
import { planRelay } from "./relay.js";
import {
  CHANNEL_ID,
  agentMembers,
  endCursor,
  readRoom,
  readSince,
  recentMessages,
  type RoomCursor,
} from "./room.js";

export const PLUGIN_NAME = "company-roadmaps";

/** The relay's own state beside the store (progress, not organization data): per roadmap, the room cursor and each room session's depth. */
export const RELAY_FILE = "roadmaps-relay.json";

/** How many earlier room messages a new room session starts with. */
export const RECENT_CONTEXT = 20;

export { RoadmapError } from "./domain.js";
export { moderatorOf } from "./guards.js";

const badRequest = (message: string): RoadmapError => new RoadmapError(400, "bad_request", message);

export interface ServiceDeps {
  gateway: Pick<
    OrgGateway,
    | "companyModeEnabled"
    | "organization"
    | "principalOf"
    | "deliverToDesk"
    | "openEmployeeSession"
    | "openRoom"
  >;
  /**
   * The session runtime's input: a later room message into an existing room session — into
   * the Task it is running when it runs one, else as its next Task.
   */
  runner: Pick<MessagingTaskRunner, "statusOf" | "steer" | "startTask">;
  /** Whether a room session still exists. */
  sessions: Pick<SessionIndex, "findById">;
  /** company-proposals' creation: what an item's second approval calls. */
  proposals: ProposalCreator;
  /** The data root (Paths.root). */
  root: string;
  log: Pick<Log, "line">;
  pluginConfig?: Pick<PluginConfig, "get">;
  now?: () => number;
}

interface RelayRoom {
  cursor: RoomCursor | null;
  depths: Record<string, number>;
}

type RelayState = Record<string, RelayRoom>;

/** A roadmap as the API answers it: the store's roadmap, its moderator and its open room sessions. */
export interface RoadmapView extends Roadmap {
  moderator: string | null;
  openClones: Array<{ agentId: string; sessionId: string }>;
}

export interface WriteResult {
  roadmap: RoadmapView;
  /** What could not be delivered, for the caller to see. */
  hints: string[];
}

export interface OpenRequest {
  name: string;
  /** An existing channel to hold the room; absent (the page's way), the roadmap opens its own. */
  channelId?: string;
  employees: string[];
  brief?: string;
  parent?: number;
}

export interface DraftRequest {
  record?: string;
  body?: string;
  items?: unknown;
}

/** An existing proposal taken into a roadmap: its number, and what the item says of it. */
export interface AdoptRequest {
  proposal?: unknown;
  title?: unknown;
  /** The employee who carries it (the proposal's implementer, else its author). */
  owner?: unknown;
  /** Defaults to the title. */
  brief?: unknown;
}

const ITEM_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_ITEMS = 50;

function isProposalNumber(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1;
}

/** The headings of a Markdown body, normalized the way a cite is compared. */
export function headingsOf(body: string): Set<string> {
  const out = new Set<string>();
  for (const line of body.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.add(normalizeCite(m[1]!));
  }
  return out;
}

export function normalizeCite(cite: string): string {
  return cite.trim().replace(/\s+/g, " ").toLowerCase();
}

function stringList(raw: unknown, what: string): string[] {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || x.trim() === "")) {
    throw badRequest(`${what} must be a list of non-empty strings.`);
  }
  return (raw as string[]).map((x) => x.trim());
}

function text(raw: unknown, what: string, max: number): string {
  if (typeof raw !== "string" || raw.trim() === "")
    throw badRequest(`${what} must be a non-empty string.`);
  if (raw.length > max) throw badRequest(`${what} is too long (max ${max} characters).`);
  return raw.trim();
}

/**
 * The draft's items, checked: unique keys, a kind, a title and a brief, at least one cite; a
 * proposal item's owner is an employee and its `stackedOn` an EARLIER proposal item (or null);
 * a roadmap item's employees are employees.
 */
export function parseItems(raw: unknown, org: Pick<OrgView, "employees">): DraftItem[] {
  if (!Array.isArray(raw)) throw badRequest("items must be a list.");
  if (raw.length > MAX_ITEMS) throw badRequest(`At most ${MAX_ITEMS} items.`);
  const employees = new Set(org.employees.map((e) => e.agentId));
  const seen = new Map<string, DraftItem["kind"]>();
  const out: DraftItem[] = [];
  for (const [i, entry] of raw.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest(`items[${i}] must be an object.`);
    }
    const o = entry as Record<string, unknown>;
    const key = o.key;
    if (typeof key !== "string" || !ITEM_KEY.test(key)) {
      throw badRequest(`items[${i}].key must be 1–40 lowercase letters, digits or dashes.`);
    }
    if (seen.has(key)) throw badRequest(`items[${i}].key repeats "${key}".`);
    const title = text(o.title, `items[${i}].title`, 200);
    const brief = text(o.brief, `items[${i}].brief`, 4000);
    // An adopted proposal (`proposal`) may predate the body, so it needs no cite.
    const cites =
      o.cites === undefined && o.proposal !== undefined
        ? []
        : stringList(o.cites, `items[${i}].cites`);
    if (cites.length === 0 && o.proposal === undefined)
      throw badRequest(`items[${i}].cites must name at least one body section.`);
    if (o.kind === "proposal") {
      const owner = typeof o.owner === "string" ? o.owner : "";
      if (!employees.has(owner)) throw badRequest(`items[${i}].owner is not an employee: ${owner}`);
      const item: DraftItem = { key, kind: "proposal", title, brief, owner, cites };
      if (o.proposal !== undefined) {
        if (!isProposalNumber(o.proposal))
          throw badRequest(`items[${i}].proposal must be a proposal number.`);
        if (out.some((x) => x.kind === "proposal" && x.proposal === o.proposal))
          throw badRequest(`items[${i}].proposal repeats proposal #${o.proposal}.`);
        item.proposal = o.proposal;
      }
      if (o.stackedOn === null) item.stackedOn = null;
      else if (o.stackedOn !== undefined) {
        if (typeof o.stackedOn !== "string" || seen.get(o.stackedOn) !== "proposal") {
          throw badRequest(
            `items[${i}].stackedOn must name an earlier proposal item: ${String(o.stackedOn)}`,
          );
        }
        item.stackedOn = o.stackedOn;
      }
      out.push(item);
    } else if (o.kind === "roadmap") {
      const list = stringList(o.employees, `items[${i}].employees`);
      if (list.length === 0)
        throw badRequest(`items[${i}].employees must name at least one employee.`);
      if (new Set(list).size !== list.length)
        throw badRequest(`items[${i}].employees repeats an employee.`);
      for (const e of list) {
        if (!employees.has(e)) throw badRequest(`items[${i}].employees: not an employee: ${e}`);
      }
      out.push({ key, kind: "roadmap", title, brief, employees: list, cites });
    } else {
      throw badRequest(`items[${i}].kind must be "proposal" or "roadmap".`);
    }
    seen.set(key, o.kind);
  }
  return out;
}

/** The cites that name no section of the body, as `key: cite`. */
export function unknownCites(body: string, items: readonly DraftItem[]): string[] {
  const headings = headingsOf(body);
  const out: string[] = [];
  for (const item of items) {
    for (const cite of item.cites) {
      if (!headings.has(normalizeCite(cite))) out.push(`${item.key}: ${cite}`);
    }
  }
  return out;
}

/** The proposal item each proposal item is stacked on: its own `stackedOn`, else the previous proposal item. */
export function basesOf(items: readonly DraftItem[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let previous: string | null = null;
  for (const item of items) {
    if (item.kind !== "proposal") continue;
    out.set(item.key, item.stackedOn === undefined ? previous : item.stackedOn);
    previous = item.key;
  }
  return out;
}

export class RoadmapService {
  private readonly stores = new Map<string, RoadmapStore>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private relaying: Promise<void> | null = null;
  /** Organizations being (or already) deleted, whose store may not open again (org-retire.ts). */
  private readonly retired = new RetiredOrgs();

  constructor(private readonly deps: ServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  config(): RoadmapConfig {
    return configOf(this.deps.pluginConfig?.get(CONFIG_GROUP) ?? {});
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /**
   * An organization's store, opened on first use. `seen` is the RetiredOrgs stamp taken before
   * the gateway found the organization: a retired organization opens again only for such a read.
   */
  private store(projectId: string, orgId: string, seen?: number): RoadmapStore {
    const key = `${projectId}/${orgId}`;
    let store = this.stores.get(key);
    if (store === undefined) {
      if (!this.retired.admit(key, seen)) {
        throw new RoadmapError(404, "org_not_found", `No organization ${orgId}.`);
      }
      store = SqliteRoadmapStore.open(companyDbPath(this.deps.root, projectId, orgId), () =>
        this.now(),
      );
      this.stores.set(key, store);
    }
    return store;
  }

  /** Runs `fn` after every earlier write of the same organization: numbers and relay state are read and written as one step. */
  private withLock<T>(projectId: string, orgId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${projectId}/${orgId}`;
    const prior = this.locks.get(key) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    this.locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /** The organization for a caller, with who the caller is; 404 while company mode is off or the organization is missing. */
  private async open(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<{ org: OrgView; caller: Caller; store: RoadmapStore }> {
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new RoadmapError(404, "not_found", "Company mode is off.");
    }
    const seen = this.retired.stamp();
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) throw new RoadmapError(404, "org_not_found", `No organization ${orgId}.`);
    const principal = await this.deps.gateway.principalOf(projectId, orgId, actor);
    const agentId = principal.startsWith("agent:") ? principal.slice("agent:".length) : null;
    // A run's writes go through a view that writes its start row in each transaction.
    return {
      org,
      caller: { principal, agentId },
      store: this.store(projectId, orgId, seen).scoped(act?.inTx),
    };
  }

  private require(store: RoadmapStore, number: number): Roadmap {
    const r = store.get(number);
    if (r === null) throw new RoadmapError(404, "roadmap_not_found", `No roadmap #${number}.`);
    return r;
  }

  private view(r: Roadmap): RoadmapView {
    return {
      ...r,
      moderator: moderatorOf(r),
      openClones: r.clones
        .filter((c) => c.closedAt === undefined)
        .map((c) => ({ agentId: c.agentId, sessionId: c.sessionId })),
    };
  }

  /** The room, checked: it exists, is not archived, and holds every one of `employees`. */
  private async requireRoom(
    projectId: string,
    orgId: string,
    channelId: string,
    employees: readonly string[],
  ): Promise<void> {
    if (!CHANNEL_ID.test(channelId)) throw badRequest(`Not a channel id: ${channelId}`);
    const room = await readRoom(orgDirOf(this.deps.root, projectId, orgId), channelId);
    if (room === null) {
      throw new RoadmapError(
        400,
        "room_not_found",
        `No channel ${channelId}: create it first (\`penguin org channel create ${channelId}\`).`,
      );
    }
    if (room.archived)
      throw new RoadmapError(409, "room_archived", `Channel ${channelId} is archived.`);
    const members = new Set(agentMembers(room));
    const missing = employees.filter((e) => !members.has(e));
    if (missing.length > 0) {
      throw new RoadmapError(
        400,
        "not_in_room",
        `Not in channel ${channelId}: ${missing.join(", ")}. Invite first: \`penguin org channel invite ${channelId} ${missing.map((m) => `agent:${m}`).join(" ")}\`.`,
      );
    }
  }

  private employeeList(raw: unknown, org: OrgView, what: string): string[] {
    const list = stringList(raw, what);
    if (list.length === 0) throw badRequest(`${what} must name at least one employee.`);
    if (new Set(list).size !== list.length) throw badRequest(`${what} repeats an employee.`);
    const known = new Set(org.employees.map((e) => e.agentId));
    for (const e of list) if (!known.has(e)) throw badRequest(`${what}: not an employee: ${e}`);
    return list;
  }

  /** One line on an employee's desk; a failure is recorded and returned as a hint rather than thrown. */
  private async deliver(
    projectId: string,
    orgId: string,
    store: RoadmapStore,
    number: number,
    agentId: string,
    line: string,
    by: string,
    hints: string[],
  ): Promise<{ delivered: boolean; error?: string }> {
    try {
      await this.deps.gateway.deliverToDesk(projectId, orgId, agentId, line);
      return { delivered: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      store.write({ kind: "notify_failed", number, agentId, error, by });
      hints.push(`${agentId} was not told: ${error}`);
      return { delivered: false, error };
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    filter: { channel?: string; status?: string } = {},
  ): Promise<{ roadmaps: RoadmapView[] }> {
    const { store } = await this.open(projectId, orgId, actor);
    const roadmaps = store
      .list({
        ...(filter.channel !== undefined ? { channel: filter.channel } : {}),
        ...(filter.status !== undefined ? { status: filter.status as RoadmapStatus } : {}),
      })
      .map((r) => this.view(r));
    return { roadmaps };
  }

  async get(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<RoadmapView> {
    const { store } = await this.open(projectId, orgId, actor);
    return this.view(this.require(store, number));
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * A person or an employee opens a roadmap over an existing room, or one it opens for itself; a
   * `parent` makes it a roadmap derived to continue a discussion elsewhere. An employee opening
   * one — typically because a person asked it to — is recorded as its opener and the room's
   * creator, and is in the room only when it names itself among the employees.
   */
  async create(
    projectId: string,
    orgId: string,
    req: OpenRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    const result = await this.withLock(projectId, orgId, async () => {
      const { org, caller, store } = await this.open(projectId, orgId, actor, act);
      (act ?? defaultAct("roadmap.open", caller, ORGANIZATION)).check(null);
      const name = text(req.name, "name", 120);
      const given = req.channelId === undefined ? null : text(req.channelId, "channelId", 64);
      const employees = this.employeeList(req.employees, org, "employees");
      if (req.parent !== undefined) this.require(store, req.parent);
      if (given !== null) await this.requireRoom(projectId, orgId, given, employees);
      const number = store.nextNumber();
      // The room: the channel named, or one this roadmap opens for itself — unlisted, reached
      // from the roadmap, with the employees in it (and the opener, when that is a person).
      const channelId =
        given ??
        (await this.openRoomFor(
          projectId,
          orgId,
          number,
          name,
          req.brief?.trim() ?? "",
          caller.principal,
          employees,
        ));
      store.write({
        kind: "opened",
        number,
        name,
        brief: req.brief?.trim() ?? "",
        channelId,
        employees,
        parent: req.parent ?? null,
        by: caller.principal,
      });
      return number;
    });
    // The room sessions open now, before the answer — the moderator's first — and every
    // employee's desk is told where it is.
    const hints = await this.relayRoadmap(projectId, orgId, result);
    hints.push(...(await this.announce(projectId, orgId, result)));
    return { roadmap: await this.get(projectId, orgId, result, actor), hints };
  }

  /** One line on each opening employee's desk: the room it is in, and the session that takes part there. */
  private announce(projectId: string, orgId: string, number: number): Promise<string[]> {
    return this.withLock(projectId, orgId, async () => {
      const hints: string[] = [];
      const store = this.store(projectId, orgId);
      const r = this.require(store, number);
      if (r.channelId === null) return hints;
      const moderator = moderatorOf(r) ?? "";
      for (const agentId of r.employees) {
        const clone = r.clones.find((c) => c.agentId === agentId && c.closedAt === undefined);
        const line = roomJoinedLine({
          roadmap: r,
          agentId,
          moderator,
          sessionId: clone?.sessionId ?? null,
        });
        await this.deliver(projectId, orgId, store, number, agentId, line, r.createdBy, hints);
      }
      return hints;
    });
  }

  /**
   * Opens the room of roadmap `number` through the organization gateway: an unlisted channel
   * `roadmap_<number>` (a suffix when that id is taken — a channel made by hand, or a store
   * restored from elsewhere), named after the roadmap, with `by` and the employees in it.
   */
  private async openRoomFor(
    projectId: string,
    orgId: string,
    number: number,
    name: string,
    brief: string,
    by: string,
    employees: readonly string[],
  ): Promise<string> {
    const purpose = (brief === "" ? `Roadmap #${number}` : `Roadmap #${number} — ${brief}`).slice(
      0,
      500,
    );
    for (let attempt = 1; attempt <= 5; attempt++) {
      const channelId = attempt === 1 ? `roadmap_${number}` : `roadmap_${number}_${attempt}`;
      try {
        await this.deps.gateway.openRoom({
          projectId,
          orgId,
          channelId,
          name,
          purpose,
          by,
          agentIds: [...employees],
        });
        return channelId;
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        if (e.code === "channel_exists") continue;
        throw new RoadmapError(
          typeof e.status === "number" ? e.status : 500,
          e.code ?? "room_failed",
          `The room could not be opened: ${e.message ?? String(err)}`,
        );
      }
    }
    throw new RoadmapError(409, "room_taken", `No free channel id for roadmap #${number}'s room.`);
  }

  /** The moderator (or a person) keeps the draft; nothing is created by it. */
  async draft(
    projectId: string,
    orgId: string,
    number: number,
    req: DraftRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { org, caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.draft", caller, roadmapSubject(number));
      a.check(this.require(store, number));
      const entry: RoadmapWrite & { kind: "draft" } = {
        kind: "draft",
        number,
        by: caller.principal,
      };
      if (req.record !== undefined) {
        if (typeof req.record !== "string" || req.record.length > 50_000) {
          throw badRequest("record must be a string of at most 50000 characters.");
        }
        entry.record = req.record;
      }
      if (req.body !== undefined) {
        if (typeof req.body !== "string" || req.body.length > 200_000) {
          throw badRequest("body must be a string of at most 200000 characters.");
        }
        entry.body = req.body;
      }
      if (req.items !== undefined) entry.items = parseItems(req.items, org);
      if (entry.record === undefined && entry.body === undefined && entry.items === undefined) {
        throw badRequest("Send at least one of record, body, items.");
      }
      store.write(entry, (now) => a.check(now));
      return { roadmap: this.view(this.require(store, number)), hints: [] };
    });
  }

  /**
   * The room agrees: the roadmap is established. A roadmap item derives its roadmap at once. A
   * proposal item is established as a brief and nothing more: no proposal is created and its
   * owner is not told until a person and the moderator have both approved that brief
   * ({@link approve}); the moderator's room session is asked for its approvals. An item already
   * established (a reopened roadmap established again) starts again only when its owner or its
   * brief changed; a roadmap item that already derived its roadmap is left to it.
   */
  async establish(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    // The derived roadmaps that got a room: their room sessions open once the lock is let go.
    const discussing: number[] = [];
    const result = await this.withLock(projectId, orgId, async () => {
      const { caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.establish", caller, roadmapSubject(number));
      const r = this.require(store, number);
      a.check(r);
      if (r.body.trim() === "")
        throw new RoadmapError(
          400,
          "body_empty",
          "The body is empty: write it before establishing.",
        );
      if (r.items.length === 0)
        throw new RoadmapError(400, "items_empty", "The roadmap has no items.");
      const unknown = unknownCites(r.body, r.items);
      if (unknown.length > 0) {
        throw new RoadmapError(
          400,
          "cite_unknown",
          `Cites naming no section of the body: ${unknown.join("; ")}`,
        );
      }
      store.write({ kind: "established", number, by: caller.principal }, (now) => a.check(now));
      const hints: string[] = [];
      const bases = basesOf(r.items);
      const briefed: Array<DraftItem & { kind: "proposal" }> = [];
      for (const item of r.items) {
        const prior = r.delegations[item.key];
        if (item.kind === "proposal" && item.proposal !== undefined) {
          // An adopted proposal exists already: nothing is created, nothing needs approving and
          // nobody is told to create it — it is delegated to its owner and linked at once.
          if (prior?.stage === "delegated" && prior.proposal === item.proposal) continue;
          store.write({
            kind: "delegated",
            number,
            key: item.key,
            owner: item.owner,
            brief: item.brief,
            base: bases.get(item.key) ?? null,
            child: null,
            delivered: false,
            by: caller.principal,
          });
          store.write({
            kind: "linked",
            number,
            key: item.key,
            proposal: item.proposal,
            by: caller.principal,
          });
        } else if (item.kind === "proposal") {
          if (prior !== undefined && prior.owner === item.owner && prior.brief === item.brief)
            continue;
          // A brief, waiting for its two approvals: nothing is created, nobody is told to create.
          store.write({
            kind: "briefed",
            number,
            key: item.key,
            owner: item.owner,
            brief: item.brief,
            base: bases.get(item.key) ?? null,
            by: caller.principal,
          });
          briefed.push(item);
        } else {
          if (prior !== undefined && prior.child !== null) continue;
          const child = store.nextNumber();
          // Its room is opened at once; only when that fails does it wait for one to be bound.
          let room: string | null = null;
          try {
            room = await this.openRoomFor(
              projectId,
              orgId,
              child,
              item.title,
              item.brief,
              caller.principal,
              item.employees,
            );
          } catch (err) {
            hints.push(
              `The room of "${item.title}" was not opened: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          store.write({
            kind: "opened",
            number: child,
            name: item.title,
            brief: item.brief,
            channelId: room,
            employees: item.employees,
            parent: number,
            parentItem: item.key,
            by: caller.principal,
          });
          if (room !== null) discussing.push(child);
          const moderator = item.employees[0]!;
          const derived = this.require(store, child);
          const res = await this.deliver(
            projectId,
            orgId,
            store,
            child,
            moderator,
            room !== null
              ? roomOpenedLine({ parent: r, child: derived })
              : roomRequestLine({ parent: r, child: derived }),
            caller.principal,
            hints,
          );
          store.write({
            kind: "delegated",
            number,
            key: item.key,
            owner: moderator,
            brief: item.brief,
            base: null,
            child,
            delivered: res.delivered,
            ...(res.error !== undefined ? { error: res.error } : {}),
            by: caller.principal,
          });
        }
      }
      // The moderator is asked for its approvals in its room session, where it works the roadmap.
      if (briefed.length > 0) {
        const established = this.require(store, number);
        const moderator = moderatorOf(established);
        const clone = established.clones.find(
          (c) => c.agentId === moderator && c.closedAt === undefined,
        );
        if (clone === undefined) {
          hints.push(
            `The moderator ${moderator ?? "(none)"} has no open room session to ask for its approvals.`,
          );
        } else {
          try {
            await this.tell(
              clone.sessionId,
              approvalRequestLine({ orgId, roadmap: established, items: briefed }),
            );
          } catch (err) {
            hints.push(
              `The moderator's room session was not asked for its approvals: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      return { roadmap: this.view(this.require(store, number)), hints };
    });
    for (const child of discussing) {
      result.hints.push(...(await this.relayRoadmap(projectId, orgId, child)));
    }
    return result;
  }

  /**
   * One of the two approvals a proposal item needs before its proposal is created: a person
   * approves as the person, the moderator as the moderator; nobody else approves, and nobody
   * approves twice. Only an established roadmap's items, and only while they are briefs.
   *
   * The second approval creates the proposal — through company-proposals, its owner the
   * author, its title and brief the item's — before anything is recorded here: a creation
   * that fails fails the approval, which stands unrecorded and can be given again. Then the
   * approval, the delegation and the link are recorded, the owner is told the number (with
   * who approved and when), and the owners stacked on the item learn it too.
   *
   * An item still linked to its proposal — a re-establishment changed its brief and kept the
   * link — creates nothing while that proposal is open: its brief is rewritten to the item's
   * (proposalOfApproval), the link stays, and the owner is told of the rewrite; the owners
   * stacked on it know the number already. Merged or rejected, a new proposal is created and
   * linked in its place, as for an item with none.
   */
  async approve(
    projectId: string,
    orgId: string,
    number: number,
    key: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.item.approve", caller, itemSubject(number, key));
      const r = this.require(store, number);
      const verdict = a.check(r);
      const { role, item, last } = approvalRole(r, key, caller, verdictRoles(verdict));
      const d = r.delegations[key]!;
      let made: { number: number; rebriefed: boolean } | null = null;
      if (last) {
        try {
          made = await proposalOfApproval(this.deps.proposals, projectId, orgId, {
            linked: d.proposal,
            owner: item.owner,
            title: item.title,
            brief: d.brief,
            delegatedBy: caller.principal,
            roadmap: { number, key },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new RoadmapError(
            409,
            "proposal_not_created",
            `Item ${key}'s proposal could not be ${d.proposal === undefined ? "created" : "created or rewritten"}, so this approval is not recorded: ${message}`,
          );
        }
      }
      // One transaction: the approval on the brief it was given on (the rules again, in the
      // write) and, when it is the second, the delegation and the link to the proposal. A
      // failure between the creation above and this write leaves the proposal unlinked and the
      // approval unrecorded; approving again finds the same proposal (createFromRoadmap is
      // idempotent on the item and its brief, a rewrite on the brief) and links it. A rewritten
      // proposal is linked already: the delegation keeps it.
      const approved: RoadmapWrite = {
        kind: "approved",
        number,
        key,
        role,
        brief: d.brief,
        by: caller.principal,
      };
      store.write(
        made === null
          ? approved
          : [
              approved,
              {
                kind: "delegated",
                number,
                key,
                owner: item.owner,
                brief: d.brief,
                base: d.base,
                child: null,
                delivered: false,
                by: caller.principal,
              },
              ...(made.rebriefed
                ? []
                : [
                    {
                      kind: "linked" as const,
                      number,
                      key,
                      proposal: made.number,
                      by: caller.principal,
                    },
                  ]),
            ],
        (now) => a.check(now, { params: { brief: d.brief } }),
      );
      const hints: string[] = [];
      const now = this.require(store, number).delegations[key]!;
      if (made !== null) {
        const proposal = made.number;
        const base = now.base === null ? null : (r.items.find((x) => x.key === now.base) ?? null);
        const baseProposal = now.base === null ? undefined : r.delegations[now.base]?.proposal;
        const line = approvedLine({
          roadmap: r,
          item,
          base:
            base === null
              ? null
              : {
                  title: base.title,
                  ...(baseProposal !== undefined ? { proposal: baseProposal } : {}),
                },
          approvals: Object.entries(now.approvals).map(([role, x]) => ({ role, ...x })),
          proposal,
          rebriefed: made.rebriefed,
        });
        const res = await this.deliver(
          projectId,
          orgId,
          store,
          number,
          item.owner,
          line,
          caller.principal,
          hints,
        );
        store.recordDelivery(number, key, res.delivered, res.error ?? null);
        if (!made.rebriefed) {
          await this.tellStacked(projectId, orgId, store, r, item, proposal, caller, hints);
        }
      }
      return { roadmap: this.view(this.require(store, number)), hints };
    });
  }

  /**
   * The owner links the proposal it created; the owners stacked on it learn its number.
   *
   * An item still a brief is linked only by a person or a moderator that does not own it, and
   * only to say what it is: a proposal that exists already. Its two approvals are what start the work on a new
   * proposal ("approve start"), and an existing one has nothing to start — so the item is
   * delegated and linked at once, without them, and its owner is told nothing. From its owner's
   * desk the brief still waits for both (409 `not_approved`).
   */
  async link(
    projectId: string,
    orgId: string,
    number: number,
    key: string,
    proposal: unknown,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.item.link", caller, itemSubject(number, key));
      const r = this.require(store, number);
      a.check(r);
      const d = r.delegations[key]!;
      // A brief is linked to the proposal it already is: delegated and linked at once.
      const existing = d.stage === "brief";
      const item = r.items.find((x) => x.key === key)!;
      if (!isProposalNumber(proposal)) throw badRequest("proposal must be a proposal number.");
      const linked: RoadmapWrite = { kind: "linked", number, key, proposal, by: caller.principal };
      store.write(
        existing
          ? [
              {
                kind: "delegated",
                number,
                key,
                owner: d.owner,
                brief: d.brief,
                base: d.base,
                child: null,
                delivered: false,
                by: caller.principal,
              },
              linked,
            ]
          : linked,
        (now) => a.check(now),
      );
      const hints: string[] = [];
      await this.tellStacked(projectId, orgId, store, r, item, proposal, caller, hints);
      return { roadmap: this.view(this.require(store, number)), hints };
    });
  }

  /** The owners of the items stacked on `item` learn the number of its proposal (not the caller's own). */
  private async tellStacked(
    projectId: string,
    orgId: string,
    store: RoadmapStore,
    r: Roadmap,
    item: DraftItem,
    proposal: number,
    caller: Caller,
    hints: string[],
  ): Promise<void> {
    for (const [depKey, base] of basesOf(r.items)) {
      if (base !== item.key) continue;
      const dep = r.items.find((x) => x.key === depKey);
      const depOwner = r.delegations[depKey]?.owner;
      if (dep === undefined || depOwner === undefined || depOwner === caller.agentId) continue;
      await this.deliver(
        projectId,
        orgId,
        store,
        r.number,
        depOwner,
        baseLinkedLine(r, dep, item, proposal),
        caller.principal,
        hints,
      );
    }
  }

  /**
   * Takes an existing proposal into the roadmap as a proposal item (a person or the moderator).
   * While the room discusses, it joins the draft's items; on an established roadmap it is
   * delegated to its owner and linked at once, as an establishment does with an adopted item.
   * Nothing is created and nothing waits for approvals: the proposal has its own page for that.
   */
  async adopt(
    projectId: string,
    orgId: string,
    number: number,
    req: AdoptRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { org, caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.adopt", caller, roadmapSubject(number));
      const r = this.require(store, number);
      a.check(r);
      if (!isProposalNumber(req.proposal)) throw badRequest("proposal must be a proposal number.");
      const proposal = req.proposal;
      const title = text(req.title, "title", 200);
      const brief = req.brief === undefined ? title : text(req.brief, "brief", 4000);
      const owner = typeof req.owner === "string" ? req.owner : "";
      if (!org.employees.some((e) => e.agentId === owner))
        throw badRequest(`owner is not an employee: ${owner}`);
      const inIt =
        r.items.some((i) => i.kind === "proposal" && i.proposal === proposal) ||
        Object.values(r.delegations).some((d) => d.proposal === proposal);
      if (inIt) {
        throw new RoadmapError(
          409,
          "already_adopted",
          `Proposal #${proposal} is in roadmap #${number} already.`,
        );
      }
      if (r.items.length >= MAX_ITEMS) throw badRequest(`At most ${MAX_ITEMS} items.`);
      const keys = new Set(r.items.map((i) => i.key));
      let key = `proposal-${proposal}`;
      for (let n = 2; keys.has(key); n++) key = `proposal-${proposal}-${n}`;
      // Stacked on nothing: the proposal already stands on whatever it was written against.
      const item: ProposalItem = {
        key,
        kind: "proposal",
        title,
        brief,
        owner,
        cites: [],
        stackedOn: null,
        proposal,
      };
      const adopted: RoadmapWrite = { kind: "adopted", number, item, by: caller.principal };
      store.write(
        r.status === "established"
          ? [
              adopted,
              {
                kind: "delegated",
                number,
                key,
                owner,
                brief,
                base: null,
                child: null,
                delivered: false,
                by: caller.principal,
              },
              { kind: "linked", number, key, proposal, by: caller.principal },
            ]
          : adopted,
        (now) => a.check(now),
      );
      return { roadmap: this.view(this.require(store, number)), hints: [] };
    });
  }

  /** An owner (or anyone of the room, or a person) finds the roadmap lacking: the room discusses again. */
  async reopen(
    projectId: string,
    orgId: string,
    number: number,
    reason: unknown,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    const why = text(reason, "reason", 4000);
    const hints = await this.withLock(projectId, orgId, async () => {
      const { caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.reopen", caller, roadmapSubject(number));
      a.check(this.require(store, number));
      store.write({ kind: "reopened", number, reason: why, by: caller.principal }, (now) =>
        a.check(now),
      );
      const reopened = this.require(store, number);
      const line = reopenLine(reopened, caller.principal, why, moderatorOf(reopened) ?? "");
      const out: string[] = [];
      const relay = await this.readRelay(projectId, orgId);
      const room = relay[String(number)] ?? { cursor: null, depths: {} };
      for (const clone of reopened.clones.filter((c) => c.closedAt === undefined)) {
        try {
          await this.tell(clone.sessionId, line);
          room.depths[clone.agentId] = 0;
        } catch (err) {
          out.push(
            `${clone.agentId}'s room session was not told: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // What the room said while the roadmap stood established was never relayed and is not now:
      // the reopening, not the backlog, is what the room sessions answer.
      room.cursor =
        reopened.channelId === null
          ? null
          : await endCursor(orgDirOf(this.deps.root, projectId, orgId), reopened.channelId);
      relay[String(number)] = room;
      await this.writeRelay(projectId, orgId, relay);
      return out;
    });
    hints.push(...(await this.relayRoadmap(projectId, orgId, number)));
    return { roadmap: await this.get(projectId, orgId, number, actor), hints };
  }

  /** A derived roadmap gets its room: its moderator (or a person) binds the channel it opened. */
  async bindRoom(
    projectId: string,
    orgId: string,
    number: number,
    channelId: unknown,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    await this.withLock(projectId, orgId, async () => {
      const { caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.room", caller, roadmapSubject(number));
      const r = this.require(store, number);
      a.check(r);
      const id = text(channelId, "channelId", 64);
      await this.requireRoom(projectId, orgId, id, r.employees);
      store.write({ kind: "room", number, channelId: id, by: caller.principal }, (now) =>
        a.check(now),
      );
    });
    const hints = await this.relayRoadmap(projectId, orgId, number);
    return { roadmap: await this.get(projectId, orgId, number, actor), hints };
  }

  async rename(
    projectId: string,
    orgId: string,
    number: number,
    name: unknown,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.rename", caller, roadmapSubject(number));
      a.check(this.require(store, number));
      store.write(
        { kind: "renamed", number, name: text(name, "name", 120), by: caller.principal },
        (now) => a.check(now),
      );
      return { roadmap: this.view(this.require(store, number)), hints: [] };
    });
  }

  // -------------------------------------------------------------------------
  // The relay
  // -------------------------------------------------------------------------

  private relayPath(projectId: string, orgId: string): string {
    return path.join(orgDirOf(this.deps.root, projectId, orgId), RELAY_FILE);
  }

  private async readRelay(projectId: string, orgId: string): Promise<RelayState> {
    try {
      const v = JSON.parse(await fs.readFile(this.relayPath(projectId, orgId), "utf8")) as unknown;
      return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RelayState) : {};
    } catch {
      return {};
    }
  }

  private async writeRelay(projectId: string, orgId: string, state: RelayState): Promise<void> {
    const file = this.relayPath(projectId, orgId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  }

  /** One pass over one roadmap's room, under the organization's lock; what went wrong comes back as hints. */
  relayRoadmap(projectId: string, orgId: string, number: number): Promise<string[]> {
    // A write that already landed (an opening, a reopening, a bound room) must not answer 500
    // because the pass after it failed: the failure is said, and the next pass tries again.
    return this.withLock(projectId, orgId, () =>
      this.relayUnlocked(projectId, orgId, number).catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        this.deps.log.line(`[company-roadmaps] #${number}: relay pass failed: ${error}`);
        return [`The room was not relayed this time: ${error}`];
      }),
    );
  }

  /**
   * One line into a room session. A session that is running a Task takes it into that Task,
   * between its steps: a queued line would wait for the Task to end, and a room session that
   * works one long Task (waiting on the room in a loop of its own) then hears nothing. One that
   * is not running — or whose Task ends before the line lands — gets it as its next Task.
   * A server older than `MessagingTaskRunner.steer` has none to offer: every line is started,
   * as before, rather than lost to the call that is not there.
   */
  private async tell(sessionId: string, text: string): Promise<void> {
    const input = [userText(text, "server")];
    if (
      typeof this.deps.runner.steer === "function" &&
      this.deps.runner.statusOf(sessionId) === "running"
    ) {
      try {
        this.deps.runner.steer(sessionId, input, { text, images: [], files: [] });
        return;
      } catch {
        // Not running any more: the line starts its next Task instead.
      }
    }
    await this.deps.runner.startTask(sessionId, input, { queueIfBusy: true });
  }

  /**
   * Syncs the room sessions with the room's members — one opened for every employee in the
   * room without one, the one of an employee who left (or whose session is gone) closed — then
   * relays every message after the cursor. Only a roadmap that is discussing, in an
   * organization that is not paused, over a room (channel) that is there and not archived.
   */
  private async relayUnlocked(projectId: string, orgId: string, number: number): Promise<string[]> {
    const hints: string[] = [];
    if (!this.deps.gateway.companyModeEnabled()) return hints;
    const store = this.store(projectId, orgId);
    const r = store.get(number);
    if (r === null || r.status !== "discussing" || r.channelId === null) return hints;
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) return hints;
    // An organization that runs on another machine is relayed THERE. What this server holds of
    // it is a mirror: its room sessions are that machine's, so here they would read as gone —
    // closed, and a second set opened on this server, speaking in the same room. Only a machine
    // named there counts: a server older than `OrgView.machineId` says nothing of where the
    // organization runs, and it is relayed as it always was rather than silently not at all.
    if (typeof org.machineId === "string" && org.machineId !== "") return hints;
    const orgDir = orgDirOf(this.deps.root, projectId, orgId);
    const room = await readRoom(orgDir, r.channelId);
    if (room === null || room.archived) return hints;
    const relay = await this.readRelay(projectId, orgId);
    const state: RelayRoom = relay[String(number)] ?? { cursor: null, depths: {} };
    const by = `plugin:${PLUGIN_NAME}`;
    const employees = new Set(org.employees.map((e) => e.agentId));
    const inRoom = agentMembers(room).filter((a) => employees.has(a));
    // Close what no longer belongs: an employee who left the room, a session deleted by hand.
    for (const c of r.clones.filter((x) => x.closedAt === undefined)) {
      const reason = !inRoom.includes(c.agentId)
        ? "left the room"
        : this.deps.sessions.findById(c.sessionId) === null
          ? "session gone"
          : null;
      if (reason === null) continue;
      store.write({
        kind: "clone_closed",
        number,
        agentId: c.agentId,
        sessionId: c.sessionId,
        reason,
        by,
      });
      delete state.depths[c.agentId];
    }
    // The room so far is the new sessions' context; the cursor starts after it.
    if (state.cursor === null) state.cursor = await endCursor(orgDir, r.channelId);
    const openNow = (): string[] =>
      this.require(store, number)
        .clones.filter((c) => c.closedAt === undefined)
        .map((c) => c.agentId);
    const order = [
      ...r.employees.filter((e) => inRoom.includes(e)),
      ...inRoom.filter((e) => !r.employees.includes(e)),
    ];
    const missing = order.filter((a) => !openNow().includes(a));
    if (missing.length > 0 && org.status !== "paused") {
      const recent = await recentMessages(orgDir, r.channelId, RECENT_CONTEXT);
      for (const agentId of missing) {
        const current = this.require(store, number);
        const moderator = current.employees.find((e) => inRoom.includes(e)) ?? order[0]!;
        try {
          const opened = await this.deps.gateway.openEmployeeSession({
            projectId,
            orgId,
            agentId,
            title: `${r.name} · roadmap #${number}`,
            body: cloneBrief({
              orgId,
              roadmap: current,
              agentId,
              moderator,
              members: order,
              recent,
            }),
          });
          store.write({ kind: "clone", number, agentId, sessionId: opened.sessionId, by });
          state.depths[agentId] = 0;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          hints.push(`No room session for ${agentId}: ${error}`);
          this.deps.log.line(
            `[company-roadmaps] #${number}: no room session for ${agentId}: ${error}`,
          );
        }
      }
    }
    const { messages, cursor, skipped } = await readSince(orgDir, r.channelId, state.cursor);
    if (skipped > 0)
      this.deps.log.line(`[company-roadmaps] #${number}: ${skipped} room line(s) skipped`);
    // A paused organization is not relayed to; its messages are passed over, as its desks' are.
    if (org.status !== "paused") {
      const limit = this.config().relayDepth;
      const current = this.require(store, number);
      for (const msg of messages) {
        const open = current.clones.filter((c) => c.closedAt === undefined);
        const plan = planRelay(
          msg,
          open.map((c) => c.agentId),
          state.depths,
          limit,
        );
        for (const agentId of plan.to) {
          const clone = open.find((c) => c.agentId === agentId)!;
          try {
            await this.tell(clone.sessionId, relayLine(current, msg));
          } catch (err) {
            // Closed now, reopened on the next pass (with the room so far as its context).
            const error = err instanceof Error ? err.message : String(err);
            store.write({
              kind: "clone_closed",
              number,
              agentId,
              sessionId: clone.sessionId,
              reason: error,
              by,
            });
            delete state.depths[agentId];
            hints.push(`${agentId}'s room session did not take ${msg.id}: ${error}`);
          }
        }
      }
    }
    state.cursor = cursor;
    relay[String(number)] = state;
    await this.writeRelay(projectId, orgId, relay);
    return hints;
  }

  /** The organizations with a store on disk. */
  private async knownOrgs(): Promise<Array<{ projectId: string; orgId: string }>> {
    const out: Array<{ projectId: string; orgId: string }> = [];
    const seen = new Set<string>();
    for (const key of this.stores.keys()) {
      const [projectId, orgId] = key.split("/") as [string, string];
      seen.add(key);
      out.push({ projectId, orgId });
    }
    let projects: string[] = [];
    try {
      projects = await fs.readdir(this.deps.root);
    } catch {
      return out;
    }
    for (const projectId of projects) {
      let orgs: string[];
      try {
        orgs = await fs.readdir(path.join(this.deps.root, projectId, "organizations"));
      } catch {
        continue;
      }
      for (const orgId of orgs) {
        if (seen.has(`${projectId}/${orgId}`)) continue;
        try {
          await fs.access(path.join(orgDirOf(this.deps.root, projectId, orgId), COMPANY_DB));
        } catch {
          continue;
        }
        seen.add(`${projectId}/${orgId}`);
        out.push({ projectId, orgId });
      }
    }
    return out;
  }

  /** One pass over every discussing roadmap of every organization; a pass still running is not doubled. */
  relayOnce(): Promise<void> {
    if (this.relaying !== null) return this.relaying;
    this.relaying = (async () => {
      try {
        if (!this.deps.gateway.companyModeEnabled()) return;
        for (const { projectId, orgId } of await this.knownOrgs()) {
          // A retired organization is not reopened by a pass: its delete is running or done.
          if (!this.retired.admit(`${projectId}/${orgId}`)) continue;
          const store = this.store(projectId, orgId);
          for (const r of store.list({ status: "discussing" })) {
            if (r.status !== "discussing") continue;
            await this.relayRoadmap(projectId, orgId, r.number);
          }
        }
      } catch (err) {
        this.deps.log.line(
          `[company-roadmaps] relay pass failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.relaying = null;
      }
    })();
    return this.relaying;
  }

  /** Relays on a timer (the configured period, re-read every tick). */
  start(): void {
    if (this.timer !== null) return;
    let last = 0;
    this.timer = setInterval(() => {
      const period = this.config().pollSeconds * 1000;
      if (this.now() - last < period) return;
      last = this.now();
      void this.relayOnce();
    }, 1000);
    this.timer.unref?.();
  }

  /**
   * The organization is being deleted (org-retire.ts): its writes and relay passes in flight
   * awaited, its connection closed, its lock chain dropped; its store opens again only for an
   * organization found anew.
   */
  async retire(projectId: string, orgId: string): Promise<void> {
    const key = `${projectId}/${orgId}`;
    this.retired.retire(key);
    await this.locks.get(key);
    const store = this.stores.get(key);
    this.stores.delete(key);
    this.locks.delete(key);
    store?.close();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.relaying;
    for (const store of this.stores.values()) store.close();
    this.stores.clear();
  }
}

/** The subjects of a use case called directly, for the default guard of its Action. */
const ORGANIZATION: Subject = { kind: "organization", id: "", text: "organization" };
const roadmapSubject = (number: number): Subject => ({
  kind: "roadmap",
  id: String(number),
  text: `roadmap:${number}`,
});
const itemSubject = (number: number, key: string): Subject => ({
  kind: "item",
  id: `${number}/${key}`,
  text: `item:${number}/${key}`,
});
