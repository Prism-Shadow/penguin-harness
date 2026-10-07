/**
 * The roadmap state machine and the desk deliveries.
 *
 * A roadmap is opened by a person or an employee over an organization channel (its room) with one
 * or more employees, the first of whom moderates (until `roadmap.members` names a moderator:
 * members.ts). The room is an ordinary channel: its members are the roadmap's, and the
 * organization delivers its messages to their desks as it delivers any channel's — the plugin
 * opens no session of its own and relays nothing. Each member's desk is told once that it is
 * in the room (`notify.roadmap.room_joined`). The moderator
 * keeps the draft (a record, a body written as a paper, items that are only briefs); nothing
 * is created while the room discusses. Establishing ends the discussion; a proposal item
 * waits there as a brief until a person and the moderator approve it, and the second approval
 * creates its proposal through company-proposals (its owner the author), links it and tells
 * the owner the number — stacked on the previous proposal item unless it says otherwise. A
 * roadmap item becomes a derived roadmap waiting for its room. An owner who finds the roadmap
 * lacking reopens it, and the room discusses again.
 */
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import { RetiredOrgs } from "./org-retire.js";
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
import { sendNotice } from "./notices.js";
import { NoticeDelivery } from "./notice-delivery.js";
import type { RoadmapStore } from "./ports.js";
import { companyDbPath } from "./schema.js";
import { SqliteRoadmapStore } from "./store.js";
import {
  baseLinkedLine,
  approvalRequestLine,
  approvedLine,
  reopenLine,
  roomJoinedLine,
  roomOpenedLine,
  roomRequestLine,
} from "./lines.js";
import { changeMembers, roomFollowsRoadmap, type MembersRequest } from "./members.js";
import { addItem, removeItem } from "./item-edits.js";
import { CHANNEL_ID, agentMembers, readRoom } from "./room.js";
import {
  MAX_ITEMS,
  basesOf,
  isProposalNumber,
  parseItems,
  stringList,
  text,
  unknownCites,
} from "./items.js";

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
    | "openRoom"
    | "changeRoomMembers"
  >;
  /** company-proposals' creation: what an item's second approval calls. */
  proposals: ProposalCreator;
  /** The data root (Paths.root). */
  root: string;
  now?: () => number;
}

/** A roadmap as the API answers it: the store's roadmap and its moderator. */
export interface RoadmapView extends Roadmap {
  moderator: string | null;
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

export class RoadmapService {
  private readonly stores = new Map<string, RoadmapStore>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Organizations being (or already) deleted, whose store may not open again (org-retire.ts). */
  private readonly retired = new RetiredOrgs();

  /** What the built-in notices do: the desk lines (notice-delivery.ts). */
  readonly notices: NoticeDelivery;

  constructor(private readonly deps: ServiceDeps) {
    this.notices = new NoticeDelivery({
      gateway: deps.gateway,
      recordFailed: (projectId, orgId, number, agentId, error, by) =>
        this.store(projectId, orgId).write({ kind: "notify_failed", number, agentId, error, by }),
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
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

  /** Runs `fn` after every earlier write of the same organization: numbers are read and written as one step. */
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
    return { ...r, moderator: moderatorOf(r) };
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
    // Every employee's desk is told where it is — the moderator's first.
    const hints = await this.announce(projectId, orgId, result, act);
    return { roadmap: await this.get(projectId, orgId, result, actor), hints };
  }

  /**
   * One line on each member's desk: the room it is in and how to take part there — each the
   * notice `notify.roadmap.room_joined` of the write (`act`) that opened the room or bound it.
   */
  private announce(
    projectId: string,
    orgId: string,
    number: number,
    act: WriteAct | undefined,
  ): Promise<string[]> {
    return this.withLock(projectId, orgId, async () => {
      const hints: string[] = [];
      const store = this.store(projectId, orgId);
      const r = this.require(store, number);
      if (r.channelId === null) return hints;
      const moderator = moderatorOf(r) ?? "";
      for (const agentId of r.employees) {
        const line = roomJoinedLine({ orgId, roadmap: r, agentId, moderator });
        await sendNotice(
          act,
          "room_joined",
          roadmapSubject(number).text,
          { to: [agentId], text: line },
          () => this.notices.desk(projectId, orgId, number, [agentId], line, r.createdBy),
          hints,
          notTold,
        );
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

  /**
   * The moderator (or a person) keeps the draft; nothing is created by it. `items` replaces the
   * whole list: the answer names the keys it removed.
   */
  async draft(
    projectId: string,
    orgId: string,
    number: number,
    req: DraftRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult & { removed: string[] }> {
    return this.withLock(projectId, orgId, async () => {
      const { org, caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.draft", caller, roadmapSubject(number));
      const before = this.require(store, number);
      a.check(before);
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
      const kept = entry.items?.map((i) => i.key);
      const removed =
        kept === undefined ? [] : before.items.map((i) => i.key).filter((k) => !kept.includes(k));
      return { roadmap: this.view(this.require(store, number)), hints: [], removed };
    });
  }

  /** `roadmap.item.add`: one item appended to a discussing roadmap's draft (item-edits.ts). */
  async addItem(
    projectId: string,
    orgId: string,
    number: number,
    item: unknown,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { org, caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.item.add", caller, roadmapSubject(number));
      const r = addItem({ org, caller, store, act: a }, number, item);
      return { roadmap: this.view(r), hints: [] };
    });
  }

  /** `roadmap.item.remove`: one item left out of a discussing roadmap's draft (item-edits.ts). */
  async removeItem(
    projectId: string,
    orgId: string,
    number: number,
    key: unknown,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    return this.withLock(projectId, orgId, async () => {
      const { org, caller, store } = await this.open(projectId, orgId, actor, act);
      const a = act ?? defaultAct("roadmap.item.remove", caller, roadmapSubject(number));
      const r = removeItem({ org, caller, store, act: a }, number, key);
      return { roadmap: this.view(r), hints: [] };
    });
  }

  /**
   * The room agrees: the roadmap is established. A roadmap item derives its roadmap at once. A
   * proposal item is established as a brief and nothing more: no proposal is created and its
   * owner is not told until a person and the moderator have both approved that brief
   * ({@link approve}); the moderator's desk is asked for its approvals. An item already
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
    // The derived roadmaps that got a room: their members are told once the lock is let go.
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
          // The derived roadmap is the notice's subject: a desk that cannot take it is recorded
          // there, where the moderator works it.
          const line =
            room !== null
              ? roomOpenedLine({ parent: r, child: derived })
              : roomRequestLine({ parent: r, child: derived });
          const res = await sendNotice(
            a,
            "derived",
            roadmapSubject(child).text,
            { to: [moderator], text: line },
            () => this.notices.desk(projectId, orgId, child, [moderator], line, caller.principal),
            hints,
            notTold,
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
      // The moderator is asked for its approvals at its desk, where it works the roadmap.
      if (briefed.length > 0) {
        const established = this.require(store, number);
        const moderator = moderatorOf(established);
        if (moderator === null) {
          hints.push("The roadmap has no moderator to ask for its approvals.");
        } else {
          const text = approvalRequestLine({ orgId, roadmap: established, items: briefed });
          await sendNotice(
            a,
            "approval_requested",
            roadmapSubject(number).text,
            { to: [moderator], text },
            () => this.notices.desk(projectId, orgId, number, [moderator], text, caller.principal),
            hints,
            (f) => `The moderator was not asked for its approvals: ${f.error}`,
          );
        }
      }
      return { roadmap: this.view(this.require(store, number)), hints };
    });
    for (const child of discussing) {
      result.hints.push(...(await this.announce(projectId, orgId, child, act)));
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
          made = await proposalOfApproval(
            this.deps.proposals,
            projectId,
            orgId,
            {
              linked: d.proposal,
              owner: item.owner,
              title: item.title,
              brief: d.brief,
              delegatedBy: caller.principal,
              roadmap: { number, key },
            },
            a.notify,
          );
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
        const res = await sendNotice(
          a,
          "item_approved",
          itemSubject(number, key).text,
          { to: [item.owner], text: line },
          () => this.notices.desk(projectId, orgId, number, [item.owner], line, caller.principal),
          hints,
          notTold,
        );
        store.recordDelivery(number, key, res.delivered, res.error ?? null);
        if (!made.rebriefed) {
          await this.tellStacked(projectId, orgId, a, r, item, proposal, caller, hints);
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
      await this.tellStacked(projectId, orgId, a, r, item, proposal, caller, hints);
      return { roadmap: this.view(this.require(store, number)), hints };
    });
  }

  /**
   * The owners of the items stacked on `item` learn the number of its proposal (not the caller's
   * own), each by the notice `notify.roadmap.base_linked` of the write (`act`).
   */
  private async tellStacked(
    projectId: string,
    orgId: string,
    act: WriteAct,
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
      const text = baseLinkedLine(r, dep, item, proposal);
      await sendNotice(
        act,
        "base_linked",
        itemSubject(r.number, item.key).text,
        { to: [depOwner], text },
        () => this.notices.desk(projectId, orgId, r.number, [depOwner], text, caller.principal),
        hints,
        notTold,
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
      const out: string[] = [];
      // The room discusses again with the roadmap's members in it: one who left the channel
      // meanwhile is brought back. The reopening stands when the channel cannot follow.
      if (reopened.channelId !== null) {
        try {
          await roomFollowsRoadmap(
            this.deps.gateway,
            orgDirOf(this.deps.root, projectId, orgId),
            projectId,
            orgId,
            reopened,
            caller.principal,
          );
        } catch (err) {
          out.push(err instanceof Error ? err.message : String(err));
        }
      }
      const to = reopened.employees;
      if (to.length > 0) {
        const line = reopenLine(reopened, caller.principal, why, moderatorOf(reopened) ?? "");
        await sendNotice(
          a,
          "reopened",
          roadmapSubject(number).text,
          { to, text: line },
          () => this.notices.desk(projectId, orgId, number, to, line, caller.principal),
          out,
          notTold,
        );
      }
      return out;
    });
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
    // The members are in the room already (requireRoom); each desk is told it is there.
    const hints = await this.announce(projectId, orgId, number, act);
    return { roadmap: await this.get(projectId, orgId, number, actor), hints };
  }

  /** A person or the moderator replaces the members and names the moderator (members.ts). */
  members(
    projectId: string,
    orgId: string,
    number: number,
    req: MembersRequest,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<WriteResult> {
    const host = {
      gateway: this.deps.gateway,
      notices: this.notices,
      withLock: this.withLock.bind(this),
      open: this.open.bind(this),
      get: this.get.bind(this),
    };
    return changeMembers(host, projectId, orgId, number, req, actor, act);
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

  /**
   * The organization is being deleted (org-retire.ts): its writes in flight awaited, its connection closed, its lock chain dropped; its store opens again only for an
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
    for (const store of this.stores.values()) store.close();
    this.stores.clear();
  }
}

/** The subjects of a use case called directly, for the default guard of its Action. */
const ORGANIZATION: Subject = { kind: "organization", id: "", text: "organization" };
/** The hint of a desk that was not told. */
const notTold = (f: { agentId: string; error: string }): string =>
  `${f.agentId} was not told: ${f.error}`;

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
