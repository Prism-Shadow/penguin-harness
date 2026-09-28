/**
 * The roadmap state machine, the room relay and the desk deliveries.
 *
 * A roadmap is opened by a person over an existing organization channel (its room) with one
 * or more employees, the first of whom moderates. For every employee in the room the relay
 * opens a room session — the employee's desk cloned for this discussion — through the
 * organization gateway, and puts every later room message into those sessions through the
 * session runtime's `startTask`: the room reaches the clones, never the desks. The moderator
 * keeps the draft (a record, a body written as a paper, items that are only briefs); nothing
 * is created while the room discusses. Establishing archives the roadmap and delegates every
 * item at once: a proposal item is a line on its owner's desk (the owner creates it with
 * company-proposals and links its number back), stacked on the previous proposal item unless
 * it says otherwise; a roadmap item becomes a derived roadmap waiting for its room. An owner
 * who finds the roadmap lacking reopens it, and the room discusses again.
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
import { CONFIG_GROUP, configOf, type RoadmapConfig } from "./config.js";
import {
  Ledger,
  LEDGER_FILE,
  ledgerPath,
  orgDirOf,
  type DraftItem,
  type LedgerEntry,
  type Roadmap,
  type RoadmapStatus,
} from "./ledger.js";
import {
  baseLinkedLine,
  cloneBrief,
  delegationLine,
  relayLine,
  reopenLine,
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

/** The relay's own state beside the ledger: per roadmap, the room cursor and each room session's depth. */
export const RELAY_FILE = "roadmaps-relay.json";

/** How many earlier room messages a new room session starts with. */
export const RECENT_CONTEXT = 20;

export class RoadmapError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoadmapError";
  }
}

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
  /** The session runtime's input: a later room message into an existing room session. */
  runner: Pick<MessagingTaskRunner, "startTask">;
  /** Whether a room session still exists. */
  sessions: Pick<SessionIndex, "findById">;
  /** The data root (Paths.root). */
  root: string;
  log: Pick<Log, "line">;
  pluginConfig?: Pick<PluginConfig, "get">;
  now?: () => number;
}

interface Caller {
  principal: string;
  agentId: string | null;
}

interface RelayRoom {
  cursor: RoomCursor | null;
  depths: Record<string, number>;
}

type RelayState = Record<string, RelayRoom>;

/** A roadmap as the API answers it: the ledger's fold, its moderator and its open room sessions. */
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

const ITEM_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_ITEMS = 50;

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
    const cites = stringList(o.cites, `items[${i}].cites`);
    if (cites.length === 0)
      throw badRequest(`items[${i}].cites must name at least one body section.`);
    if (o.kind === "proposal") {
      const owner = typeof o.owner === "string" ? o.owner : "";
      if (!employees.has(owner)) throw badRequest(`items[${i}].owner is not an employee: ${owner}`);
      const item: DraftItem = { key, kind: "proposal", title, brief, owner, cites };
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

/** The employee who moderates: the first of the opening employees with an open room session, else the first opener, else the earliest open session. */
export function moderatorOf(r: Roadmap): string | null {
  const open = r.clones.filter((c) => c.closedAt === undefined).map((c) => c.agentId);
  return r.employees.find((e) => open.includes(e)) ?? open[0] ?? r.employees[0] ?? null;
}

export class RoadmapService {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private relaying: Promise<void> | null = null;

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

  private ledger(projectId: string, orgId: string): Ledger {
    const key = `${projectId}/${orgId}`;
    let ledger = this.ledgers.get(key);
    if (ledger === undefined) {
      ledger = new Ledger(
        ledgerPath(this.deps.root, projectId, orgId),
        () => this.now(),
        (line) => this.deps.log.line(line),
      );
      this.ledgers.set(key, ledger);
    }
    return ledger;
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
  ): Promise<{ org: OrgView; caller: Caller; ledger: Ledger }> {
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new RoadmapError(404, "not_found", "Company mode is off.");
    }
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) throw new RoadmapError(404, "org_not_found", `No organization ${orgId}.`);
    const principal = await this.deps.gateway.principalOf(projectId, orgId, actor);
    const agentId = principal.startsWith("agent:") ? principal.slice("agent:".length) : null;
    const ledger = this.ledger(projectId, orgId);
    await ledger.load();
    return { org, caller: { principal, agentId }, ledger };
  }

  private require(ledger: Ledger, number: number): Roadmap {
    const r = ledger.get(number);
    if (r === undefined) throw new RoadmapError(404, "roadmap_not_found", `No roadmap #${number}.`);
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

  private requireStatus(r: Roadmap, status: RoadmapStatus, archived?: boolean): void {
    if (r.status !== status || (archived !== undefined && r.archived !== archived)) {
      const now = `${r.status}${r.archived ? ", archived" : ""}`;
      throw new RoadmapError(409, `not_${status}`, `Roadmap #${r.number} is ${now}.`);
    }
  }

  /** People, or the moderator. */
  private requireModeratorOrPerson(r: Roadmap, caller: Caller): void {
    if (caller.agentId === null || caller.agentId === moderatorOf(r)) return;
    throw new RoadmapError(
      403,
      "not_moderator",
      `Only a person or the moderator (${moderatorOf(r)}) may do this.`,
    );
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
    ledger: Ledger,
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
      await ledger.append({ kind: "notify_failed", number, agentId, error, by });
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
    const { ledger } = await this.open(projectId, orgId, actor);
    const roadmaps = ledger
      .roadmaps()
      .filter((r) => filter.channel === undefined || r.channelId === filter.channel)
      .filter((r) => filter.status === undefined || r.status === filter.status)
      .map((r) => this.view(r));
    return { roadmaps };
  }

  async get(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<RoadmapView> {
    const { ledger } = await this.open(projectId, orgId, actor);
    return this.view(this.require(ledger, number));
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /** A person opens a roadmap over an existing room; a `parent` makes it a roadmap derived to continue a discussion elsewhere. */
  async create(
    projectId: string,
    orgId: string,
    req: OpenRequest,
    actor: OrgActor,
  ): Promise<WriteResult> {
    const result = await this.withLock(projectId, orgId, async () => {
      const { org, caller, ledger } = await this.open(projectId, orgId, actor);
      if (caller.agentId !== null) {
        throw new RoadmapError(
          403,
          "people_only",
          "A roadmap is opened by a person; an employee drafts one as an item of the discussion it is in.",
        );
      }
      const name = text(req.name, "name", 120);
      const given = req.channelId === undefined ? null : text(req.channelId, "channelId", 64);
      const employees = this.employeeList(req.employees, org, "employees");
      if (req.parent !== undefined) this.require(ledger, req.parent);
      if (given !== null) await this.requireRoom(projectId, orgId, given, employees);
      const number = ledger.nextNumber();
      // The room: the channel named, or one this roadmap opens for itself — unlisted, reached
      // from the roadmap, with the person who opened it and the employees in it.
      const channelId =
        given ??
        (await this.openRoomFor(projectId, orgId, number, name, req.brief?.trim() ?? "", caller.principal, employees));
      await ledger.append({
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
    const hints = await this.relayRoadmap(projectId, orgId, result);
    return { roadmap: await this.get(projectId, orgId, result, actor), hints };
  }

  /**
   * Opens the room of roadmap `number` through the organization gateway: an unlisted channel
   * `roadmap_<number>` (a suffix when that id is taken — a channel made by hand, or a ledger
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
    const purpose = (brief === "" ? `Roadmap #${number}` : `Roadmap #${number} — ${brief}`).slice(0, 500);
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
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { org, caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      this.requireStatus(r, "discussing", false);
      this.requireModeratorOrPerson(r, caller);
      const entry: LedgerEntry & { kind: "draft" } = {
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
      await ledger.append(entry);
      return { roadmap: this.view(this.require(ledger, number)), hints: [] };
    });
  }

  /**
   * The room agrees: the roadmap is archived and every item delegated at once. An item already
   * delegated (a reopened roadmap established again) is delegated again only when its owner or
   * its brief changed; a roadmap item that already derived its roadmap is left to it.
   */
  async establish(
    projectId: string,
    orgId: string,
    number: number,
    actor: OrgActor,
  ): Promise<WriteResult> {
    // The derived roadmaps that got a room: their room sessions open once the lock is let go.
    const discussing: number[] = [];
    const result = await this.withLock(projectId, orgId, async () => {
      const { caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      this.requireStatus(r, "discussing", false);
      this.requireModeratorOrPerson(r, caller);
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
      await ledger.append({ kind: "established", number, by: caller.principal });
      const hints: string[] = [];
      const bases = basesOf(r.items);
      for (const item of r.items) {
        const prior = r.delegations[item.key];
        if (item.kind === "proposal") {
          if (prior !== undefined && prior.owner === item.owner && prior.brief === item.brief)
            continue;
          const baseKey = bases.get(item.key) ?? null;
          const baseItem =
            baseKey === null ? null : (r.items.find((x) => x.key === baseKey) ?? null);
          const baseProposal = baseKey === null ? undefined : r.delegations[baseKey]?.proposal;
          const line = delegationLine({
            orgId,
            roadmap: r,
            item,
            base:
              baseItem === null
                ? null
                : {
                    title: baseItem.title,
                    ...(baseProposal !== undefined ? { proposal: baseProposal } : {}),
                  },
            revised: prior !== undefined && prior.owner === item.owner,
          });
          const res = await this.deliver(
            projectId,
            orgId,
            ledger,
            number,
            item.owner,
            line,
            caller.principal,
            hints,
          );
          await ledger.append({
            kind: "delegated",
            number,
            key: item.key,
            owner: item.owner,
            brief: item.brief,
            base: baseKey,
            child: null,
            delivered: res.delivered,
            ...(res.error !== undefined ? { error: res.error } : {}),
            by: caller.principal,
          });
        } else {
          if (prior !== undefined && prior.child !== null) continue;
          const child = ledger.nextNumber();
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
            hints.push(`The room of "${item.title}" was not opened: ${err instanceof Error ? err.message : String(err)}`);
          }
          await ledger.append({
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
          const derived = this.require(ledger, child);
          const res = await this.deliver(
            projectId,
            orgId,
            ledger,
            child,
            moderator,
            room !== null
              ? roomOpenedLine({ parent: r, child: derived })
              : roomRequestLine({ orgId, parent: r, child: derived }),
            caller.principal,
            hints,
          );
          await ledger.append({
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
      return { roadmap: this.view(this.require(ledger, number)), hints };
    });
    for (const child of discussing) {
      result.hints.push(...(await this.relayRoadmap(projectId, orgId, child)));
    }
    return result;
  }

  /** The owner links the proposal it created; the owners stacked on it learn its number. */
  async link(
    projectId: string,
    orgId: string,
    number: number,
    key: string,
    proposal: unknown,
    actor: OrgActor,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      const d = r.delegations[key];
      const item = r.items.find((x) => x.key === key);
      if (d === undefined || item === undefined || item.kind !== "proposal") {
        throw new RoadmapError(
          404,
          "item_not_delegated",
          `Roadmap #${number} has delegated no proposal item ${key}.`,
        );
      }
      if (caller.agentId !== null && caller.agentId !== d.owner) {
        throw new RoadmapError(403, "not_owner", `Only ${d.owner} (or a person) links ${key}.`);
      }
      if (typeof proposal !== "number" || !Number.isInteger(proposal) || proposal < 1) {
        throw badRequest("proposal must be a proposal number.");
      }
      await ledger.append({ kind: "linked", number, key, proposal, by: caller.principal });
      const hints: string[] = [];
      for (const [depKey, base] of basesOf(r.items)) {
        if (base !== key) continue;
        const dep = r.items.find((x) => x.key === depKey);
        const depOwner = r.delegations[depKey]?.owner;
        if (dep === undefined || depOwner === undefined || depOwner === caller.agentId) continue;
        await this.deliver(
          projectId,
          orgId,
          ledger,
          number,
          depOwner,
          baseLinkedLine(r, dep, item, proposal),
          caller.principal,
          hints,
        );
      }
      return { roadmap: this.view(this.require(ledger, number)), hints };
    });
  }

  /** An owner (or anyone of the room, or a person) finds the roadmap lacking: the room discusses again. */
  async reopen(
    projectId: string,
    orgId: string,
    number: number,
    reason: unknown,
    actor: OrgActor,
  ): Promise<WriteResult> {
    const why = text(reason, "reason", 4000);
    const hints = await this.withLock(projectId, orgId, async () => {
      const { caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      this.requireStatus(r, "established");
      if (caller.agentId !== null) {
        const owners = Object.values(r.delegations).map((d) => d.owner);
        const room = [...r.employees, ...r.clones.map((c) => c.agentId)];
        if (!owners.includes(caller.agentId) && !room.includes(caller.agentId)) {
          throw new RoadmapError(
            403,
            "not_involved",
            `Only an owner, an employee of the room, or a person reopens roadmap #${number}.`,
          );
        }
      }
      await ledger.append({ kind: "reopened", number, reason: why, by: caller.principal });
      const reopened = this.require(ledger, number);
      const line = reopenLine(reopened, caller.principal, why, moderatorOf(reopened) ?? "");
      const out: string[] = [];
      const relay = await this.readRelay(projectId, orgId);
      const room = relay[String(number)] ?? { cursor: null, depths: {} };
      for (const clone of reopened.clones.filter((c) => c.closedAt === undefined)) {
        try {
          await this.deps.runner.startTask(clone.sessionId, [userText(line, "server")], {
            queueIfBusy: true,
          });
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
  ): Promise<WriteResult> {
    await this.withLock(projectId, orgId, async () => {
      const { caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      this.requireStatus(r, "awaiting_room");
      this.requireModeratorOrPerson(r, caller);
      const id = text(channelId, "channelId", 64);
      await this.requireRoom(projectId, orgId, id, r.employees);
      await ledger.append({ kind: "room", number, channelId: id, by: caller.principal });
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
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      this.requireModeratorOrPerson(r, caller);
      await ledger.append({
        kind: "renamed",
        number,
        name: text(name, "name", 120),
        by: caller.principal,
      });
      return { roadmap: this.view(this.require(ledger, number)), hints: [] };
    });
  }

  /** Shelve a roadmap (the relay stops), or take it off the shelf; an established one is reopened instead. */
  async setArchived(
    projectId: string,
    orgId: string,
    number: number,
    archived: boolean,
    actor: OrgActor,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { caller, ledger } = await this.open(projectId, orgId, actor);
      const r = this.require(ledger, number);
      this.requireModeratorOrPerson(r, caller);
      if (r.archived === archived) {
        throw new RoadmapError(
          409,
          archived ? "already_archived" : "not_archived",
          `Roadmap #${number} is ${archived ? "already" : "not"} archived.`,
        );
      }
      if (!archived && r.status === "established") {
        throw new RoadmapError(
          409,
          "established",
          `Roadmap #${number} is established: reopen it instead.`,
        );
      }
      await ledger.append({
        kind: archived ? "archived" : "unarchived",
        number,
        by: caller.principal,
      });
      return { roadmap: this.view(this.require(ledger, number)), hints: [] };
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
   * Syncs the room sessions with the room's members — one opened for every employee in the
   * room without one, the one of an employee who left (or whose session is gone) closed — then
   * relays every message after the cursor. Only a roadmap that is discussing, not archived, in
   * an organization that is not paused, over a room that is there and not archived.
   */
  private async relayUnlocked(projectId: string, orgId: string, number: number): Promise<string[]> {
    const hints: string[] = [];
    if (!this.deps.gateway.companyModeEnabled()) return hints;
    const ledger = this.ledger(projectId, orgId);
    await ledger.load();
    const r = ledger.get(number);
    if (r === undefined || r.status !== "discussing" || r.archived || r.channelId === null)
      return hints;
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) return hints;
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
      await ledger.append({
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
      this.require(ledger, number)
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
        const current = this.require(ledger, number);
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
          await ledger.append({ kind: "clone", number, agentId, sessionId: opened.sessionId, by });
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
      const current = this.require(ledger, number);
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
            await this.deps.runner.startTask(
              clone.sessionId,
              [userText(relayLine(current, msg), "server")],
              {
                queueIfBusy: true,
              },
            );
          } catch (err) {
            // Closed now, reopened on the next pass (with the room so far as its context).
            const error = err instanceof Error ? err.message : String(err);
            await ledger.append({
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

  /** The organizations with a roadmap ledger on disk. */
  private async knownOrgs(): Promise<Array<{ projectId: string; orgId: string }>> {
    const out: Array<{ projectId: string; orgId: string }> = [];
    const seen = new Set<string>();
    for (const key of this.ledgers.keys()) {
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
          await fs.access(path.join(orgDirOf(this.deps.root, projectId, orgId), LEDGER_FILE));
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
          const ledger = this.ledger(projectId, orgId);
          await ledger.load();
          for (const r of ledger.roadmaps()) {
            if (r.status !== "discussing" || r.archived) continue;
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

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.relaying;
  }
}
