/**
 * `roadmap.members`: a roadmap's members replaced and its moderator named.
 *
 * The members are fixed when a roadmap opens; this is the one write that changes them, and the
 * one way out for a member that left the organization (it is not dropped on its own). The write
 * is an append-only `members` event that records the members and moderator before and after;
 * the moderator it names is stored as such, and from then on moderatorOf (guards.ts) answers it
 * instead of deriving one — so the `moderator` approval of an item is the named moderator's,
 * while approvals already given stand.
 *
 * The room follows: when the roadmap has a room, the employees added join its channel and the
 * ones removed leave it, through the organization gateway, before the write is recorded (a
 * room that cannot follow refuses the write). The channel is an ordinary one, so a member in it
 * takes part from its desk and one out of it hears no more of it. While the roadmap is
 * discussing, each new member is then told through the notice `notify.roadmap.room_joined`; in
 * any other status only the channel changes.
 */
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { Roadmap } from "./domain.js";
import type { Subject } from "./action-shapes.js";
import { RoadmapError } from "./domain.js";
import { defaultAct, moderatorOf, type Caller, type WriteAct } from "./guards.js";
import { roomJoinedLine } from "./lines.js";
import type { NoticeDelivery } from "./notice-delivery.js";
import { sendNotice } from "./notices.js";
import type { RoadmapStore } from "./ports.js";
import { agentMembers, readRoom } from "./room.js";
import type { RoadmapView, WriteResult } from "./service.js";

/** The parameters of `roadmap.members`, as the caller sent them (checked by {@link parseMembers}). */
export interface MembersRequest {
  employees?: unknown;
  moderator?: unknown;
}

/** What `roadmap.members` needs of the service: its plumbing, nothing of its state. */
export interface MembersHost {
  gateway: Partial<Pick<OrgGateway, "changeRoomMembers">>;
  notices: Pick<NoticeDelivery, "desk">;
  withLock<T>(projectId: string, orgId: string, fn: () => Promise<T>): Promise<T>;
  open(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<{ org: OrgView; caller: Caller; store: RoadmapStore }>;
  get(projectId: string, orgId: string, number: number, actor: OrgActor): Promise<RoadmapView>;
}

const badRequest = (message: string): RoadmapError => new RoadmapError(400, "bad_request", message);

/**
 * The new members and moderator, checked: a non-empty list of distinct employees of the
 * organization as it is now (one that left is not one), and a moderator among them.
 */
export function parseMembers(
  req: MembersRequest,
  org: Pick<OrgView, "employees">,
): { employees: string[]; moderator: string } {
  const raw = req.employees;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || x.trim() === "")) {
    throw badRequest("employees must be a list of non-empty strings.");
  }
  const employees = (raw as string[]).map((x) => x.trim());
  if (employees.length === 0) throw badRequest("employees must name at least one employee.");
  const repeated = employees.find((e, i) => employees.indexOf(e) !== i);
  if (repeated !== undefined) throw badRequest(`employees repeats ${repeated}.`);
  const known = new Set(org.employees.map((e) => e.agentId));
  const strangers = employees.filter((e) => !known.has(e));
  if (strangers.length > 0) {
    throw new RoadmapError(
      400,
      "not_an_employee",
      `Not employees of this organization: ${strangers.join(", ")}.`,
    );
  }
  const moderator = typeof req.moderator === "string" ? req.moderator.trim() : "";
  if (moderator === "") throw badRequest("moderator must name one of employees.");
  if (!employees.includes(moderator)) {
    throw new RoadmapError(
      400,
      "moderator_not_member",
      `The moderator ${moderator} is not among employees.`,
    );
  }
  return { employees, moderator };
}

/** `roadmap.members` on roadmap `number`: see the module comment. */
export async function changeMembers(
  host: MembersHost,
  projectId: string,
  orgId: string,
  number: number,
  req: MembersRequest,
  actor: OrgActor,
  act?: WriteAct,
): Promise<WriteResult> {
  const changed = await host.withLock(projectId, orgId, async () => {
    const { org, caller, store } = await host.open(projectId, orgId, actor, act);
    const a = act ?? defaultAct("roadmap.members", caller, roadmapSubject(number));
    const r = store.get(number);
    if (r === null) throw new RoadmapError(404, "roadmap_not_found", `No roadmap #${number}.`);
    a.check(r);
    const next = parseMembers(req, org);
    const added = next.employees.filter((e) => !r.employees.includes(e));
    const removed = r.employees.filter((e) => !next.employees.includes(e));
    if (r.channelId !== null && (added.length > 0 || removed.length > 0)) {
      await roomFollows(
        host.gateway,
        projectId,
        orgId,
        r.channelId,
        caller.principal,
        added,
        removed,
      );
    }
    store.write(
      {
        kind: "members",
        number,
        employees: next.employees,
        moderator: next.moderator,
        before: { employees: r.employees, moderator: moderatorOf(r) },
        by: caller.principal,
      },
      (now) => a.check(now),
    );
    return { added, by: caller.principal, discussing: r.status === "discussing" };
  });
  const hints: string[] = [];
  if (changed.discussing) {
    hints.push(
      ...(await tellJoined(host, projectId, orgId, number, changed.added, changed.by, actor, act)),
    );
  }
  return { roadmap: await host.get(projectId, orgId, number, actor), hints };
}

/**
 * The room's channel brought back in step with roadmap `r`'s members, as `by`: each member not
 * in the channel joins it (one that left it by hand while the room stood established). Other
 * employees in the channel stay — a room bound to an existing channel may hold more than the
 * roadmap's members. Throws as {@link roomFollows} does; a channel that is gone throws too.
 */
export async function roomFollowsRoadmap(
  gateway: Partial<Pick<OrgGateway, "changeRoomMembers">>,
  orgDir: string,
  projectId: string,
  orgId: string,
  r: Pick<Roadmap, "channelId" | "employees">,
  by: string,
): Promise<void> {
  if (r.channelId === null) return;
  const room = await readRoom(orgDir, r.channelId);
  if (room === null) {
    throw new RoadmapError(404, "room_not_found", `The room \`${r.channelId}\` is not there.`);
  }
  const inRoom = new Set(agentMembers(room));
  const missing = r.employees.filter((e) => !inRoom.has(e));
  if (missing.length === 0) return;
  await roomFollows(gateway, projectId, orgId, r.channelId, by, missing, []);
}

/** The room's channel follows the members: `added` join it and `removed` leave it, as `by`. */
async function roomFollows(
  gateway: Partial<Pick<OrgGateway, "changeRoomMembers">>,
  projectId: string,
  orgId: string,
  channelId: string,
  by: string,
  added: string[],
  removed: string[],
): Promise<void> {
  if (typeof gateway.changeRoomMembers !== "function") {
    throw new RoadmapError(
      409,
      "room_members_unsupported",
      `This server cannot change the members of the room \`${channelId}\`; update the server first.`,
    );
  }
  try {
    await gateway.changeRoomMembers({
      projectId,
      orgId,
      channelId,
      by,
      add: added,
      remove: removed,
    });
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    throw new RoadmapError(
      typeof e.status === "number" ? e.status : 500,
      e.code ?? "room_failed",
      `The members of the room \`${channelId}\` could not be changed: ${e.message ?? String(err)}`,
    );
  }
}

/** Each new member of a discussing roadmap is told its room, by the notice `notify.roadmap.room_joined`. */
function tellJoined(
  host: MembersHost,
  projectId: string,
  orgId: string,
  number: number,
  added: readonly string[],
  by: string,
  actor: OrgActor,
  act: WriteAct | undefined,
): Promise<string[]> {
  return host.withLock(projectId, orgId, async () => {
    const hints: string[] = [];
    if (added.length === 0) return hints;
    const r = await host.get(projectId, orgId, number, actor);
    for (const agentId of added) {
      const line = roomJoinedLine({
        orgId,
        roadmap: r,
        agentId,
        moderator: r.moderator ?? "",
        addedBy: by,
      });
      await sendNotice(
        act,
        "room_joined",
        roadmapSubject(number).text,
        { to: [agentId], text: line },
        () => host.notices.desk(projectId, orgId, number, [agentId], line, by),
        hints,
        (f) => `${f.agentId} was not told: ${f.error}`,
      );
    }
    return hints;
  });
}

const roadmapSubject = (number: number): Subject => ({
  kind: "roadmap",
  id: String(number),
  text: `roadmap:${number}`,
});
