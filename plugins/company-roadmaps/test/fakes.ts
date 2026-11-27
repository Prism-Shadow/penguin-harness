/**
 * What the unit suites stand the plugin on: the organization gateway and company-proposals'
 * creation as fakes that record what they were asked, and an organization directory on disk
 * whose channels are written the way the organization writes them.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import {
  RoadmapService,
  agentMembers,
  orgDirOf,
  readRoom,
  type ProposalCreator,
} from "../src/index.js";

export const PROJECT = "proj";
export const ORG = "acme";
export const BOSS: OrgActor = { userId: "boss" };
export const asAgent = (agentId: string): OrgActor => ({
  userId: "boss",
  agentId,
  sessionId: `desk-${agentId}`,
});

export class FakeGateway implements Pick<
  OrgGateway,
  | "companyModeEnabled"
  | "organization"
  | "principalOf"
  | "deliverToDesk"
  | "openEmployeeSession"
  | "openRoom"
  | "changeRoomMembers"
> {
  enabled = true;
  /** Where the organization's files are: a room is written there, the way the server writes one. */
  root = "";
  /** Every room opened, in order. */
  rooms: Array<{
    channelId: string;
    name: string;
    purpose: string;
    by: string;
    agentIds: string[];
  }> = [];
  /** Every change of a room's employees, in order. */
  memberChanges: Array<{ channelId: string; by: string; add: string[]; remove: string[] }> = [];
  /** Set by a test to make changing a room's members fail. */
  refuseMemberChanges: string | null = null;
  /** Set by a test to make opening a room fail (not a taken id). */
  refuseRooms: string | null = null;
  org: OrgView = {
    projectId: PROJECT,
    orgId: ORG,
    name: "Acme",
    status: "active",
    language: "en",
    workspace: "/tmp/acme",
    employees: [
      { agentId: "acme_ceo", name: "CEO", title: "CEO", reportsTo: null },
      { agentId: "acme_dev", name: "Dev", title: "Engineer", reportsTo: "acme_ceo" },
      { agentId: "acme_web", name: "Web", title: "Engineer", reportsTo: "acme_ceo" },
      { agentId: "acme_qa", name: "QA", title: "Tester", reportsTo: "acme_ceo" },
    ],
    userIds: ["boss"],
    machineId: null,
  };
  /** Every line put on a desk, in order. */
  desks: Array<{ agentId: string; text: string }> = [];
  /**
   * Every session opened for an employee. The plugin opens none — a room is a channel the
   * organization delivers — and the suites check it stays empty.
   */
  sessionsOpened: Array<{ agentId: string; title: string }> = [];
  /** Desks that refuse a line, with the reason. */
  refuse = new Map<string, string>();

  companyModeEnabled(): boolean {
    return this.enabled;
  }
  async organization(): Promise<OrgView | null> {
    return this.org;
  }
  async principalOf(_p: string, _o: string, actor: OrgActor): Promise<string> {
    if (
      actor.agentId !== undefined &&
      this.org.employees.some((e) => e.agentId === actor.agentId)
    ) {
      return `agent:${actor.agentId}`;
    }
    return `user:${actor.userId}`;
  }
  async deliverToDesk(_p: string, _o: string, agentId: string, text: string) {
    const refused = this.refuse.get(agentId);
    if (refused !== undefined) throw new Error(refused);
    this.desks.push({ agentId, text });
    return { sessionId: `desk-${agentId}`, queued: false };
  }
  async openEmployeeSession(args: { agentId: string; title: string }) {
    this.sessionsOpened.push({ agentId: args.agentId, title: args.title });
    return { sessionId: `session-${this.sessionsOpened.length}`, workspace: "/tmp/acme" };
  }
  /** An unlisted channel with its members, on disk as the server writes one; a taken id is refused as the server refuses it. */
  async openRoom(args: {
    channelId: string;
    name: string;
    purpose: string;
    by: string;
    agentIds: string[];
  }) {
    if (this.refuseRooms !== null)
      throw Object.assign(new Error(this.refuseRooms), { status: 500 });
    const toml = path.join(orgDir(this.root), "channels", args.channelId, "channel.toml");
    const taken = await fs.access(toml).then(
      () => true,
      () => false,
    );
    if (taken) {
      throw Object.assign(new Error(`Channel id is already taken: ${args.channelId}`), {
        status: 409,
        code: "channel_exists",
      });
    }
    this.rooms.push({ ...args, agentIds: [...args.agentIds] });
    await writeChannel(
      this.root,
      args.channelId,
      [
        ...(args.by.startsWith("user:") ? [args.by] : []),
        ...args.agentIds.map((a) => `agent:${a}`),
      ],
      { unlisted: true },
    );
    return { channelId: args.channelId };
  }
  async changeRoomMembers(args: {
    channelId: string;
    by: string;
    add: string[];
    remove: string[];
  }): Promise<{ added: string[]; removed: string[] }> {
    if (this.refuseMemberChanges !== null) {
      throw Object.assign(new Error(this.refuseMemberChanges), {
        status: 409,
        code: "org_runs_elsewhere",
      });
    }
    this.memberChanges.push({
      channelId: args.channelId,
      by: args.by,
      add: [...args.add],
      remove: [...args.remove],
    });
    return changeChannel(this.root, args);
  }
}

/** The employees of a channel changed on disk, as the server changes them: people stay, the archived and unlisted flags too. */
async function changeChannel(
  root: string,
  args: { channelId: string; add: string[]; remove: string[] },
): Promise<{ added: string[]; removed: string[] }> {
  const dir = path.join(orgDir(root), "channels", args.channelId);
  const room = await readRoom(orgDir(root), args.channelId);
  if (room === null) {
    throw Object.assign(new Error(`No channel ${args.channelId}`), {
      status: 404,
      code: "channel_not_found",
    });
  }
  const unlisted = (await fs.readFile(path.join(dir, "channel.toml"), "utf8")).includes(
    "unlisted = true",
  );
  const before = agentMembers(room);
  const removed = before.filter((a) => args.remove.includes(a));
  const added = args.add.filter((a) => !before.includes(a));
  const leaving = new Set(args.remove.map((a) => `agent:${a}`));
  const members = [
    ...room.members.filter((m) => !leaving.has(m)),
    ...added.map((a) => `agent:${a}`),
  ];
  await writeChannel(root, args.channelId, members, { archived: room.archived, unlisted });
  return { added, removed };
}

/**
 * company-proposals' creation: every proposal it was asked to create, numbered from 200 so a
 * test tells a created number from one it linked by hand; `refuse` makes the next call throw.
 * Every brief rewrite it was asked for is kept in `rebriefed`; a number in `closed` is merged
 * or rejected, so its rewrite answers false and writes nothing.
 */
export class FakeProposals implements ProposalCreator {
  created: Array<{
    projectId: string;
    orgId: string;
    author: string;
    title: string;
    brief: string;
    delegatedBy: string;
    roadmap: { number: number; key: string };
  }> = [];
  refuse: string | null = null;
  rebriefed: Array<{
    number: number;
    owner: string;
    brief: string;
    delegatedBy: string;
    roadmap: { number: number; key: string };
  }> = [];
  closed = new Set<number>();
  private next = 200;

  async rebriefFromRoadmap(
    _projectId: string,
    _orgId: string,
    number: number,
    req: {
      owner: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
  ): Promise<boolean> {
    if (this.closed.has(number)) return false;
    this.rebriefed.push({ number, ...req });
    return true;
  }

  async createFromRoadmap(
    projectId: string,
    orgId: string,
    req: {
      author: string;
      title: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
  ): Promise<number> {
    if (this.refuse !== null) {
      const message = this.refuse;
      this.refuse = null;
      throw new Error(message);
    }
    this.created.push({ projectId, orgId, ...req });
    return this.next++;
  }
}

export async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "company-roadmaps-"));
}

export function orgDir(root: string): string {
  return orgDirOf(root, PROJECT, ORG);
}

/** A channel.toml as the organization writes one (its comment header, then the table). */
export async function writeChannel(
  root: string,
  channelId: string,
  members: string[],
  opts: { archived?: boolean; unlisted?: boolean } = {},
): Promise<void> {
  const dir = path.join(orgDir(root), "channels", channelId);
  await fs.mkdir(dir, { recursive: true });
  const toml = [
    "# channel.toml — a channel (the id is the directory name under channels/).",
    `name = "${channelId}"`,
    'purpose = ""',
    'created_by = "user:boss"',
    'created_at = "2026-09-27T00:00:00.000Z"',
    `archived = ${opts.archived === true}`,
    `members = [ ${members.map((m) => `"${m}"`).join(", ")} ]`,
    ...(opts.unlisted === true ? ["unlisted = true"] : []),
    "",
  ].join("\n");
  await fs.writeFile(path.join(dir, "channel.toml"), toml, "utf8");
}

export interface World {
  root: string;
  gateway: FakeGateway;
  proposals: FakeProposals;
  service: () => RoadmapService;
}

/** A root, the fakes, and a service over them (a fresh service per call shares the root: a restart). */
export async function world(): Promise<World> {
  const root = await tempRoot();
  const w: World = {
    root,
    gateway: Object.assign(new FakeGateway(), { root }),
    proposals: new FakeProposals(),
    service: () =>
      new RoadmapService({
        gateway: w.gateway,
        proposals: w.proposals,
        root,
      }),
  };
  return w;
}
