/**
 * The roadmap ledger: one append-only JSON-lines file per organization,
 * `<root>/<project>/organizations/<org>/roadmaps.jsonl`, written only by this plugin and
 * replayed on first use. Every write is one line; the state is the fold of the lines, so a
 * roadmap's history is its lines and nothing is ever rewritten.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const LEDGER_FILE = "roadmaps.jsonl";

export function orgDirOf(root: string, projectId: string, orgId: string): string {
  return path.join(root, projectId, "organizations", orgId);
}

export function ledgerPath(root: string, projectId: string, orgId: string): string {
  return path.join(orgDirOf(root, projectId, orgId), LEDGER_FILE);
}

/**
 * `awaiting_room`: derived at an establishment, no room bound yet; `discussing`: its room is
 * relayed; `established`: the discussion is over and its items delegated. A reopening takes an
 * established roadmap back to discussing; there is no other state.
 */
export type RoadmapStatus = "awaiting_room" | "discussing" | "established";

/** A proposal the roadmap delegates: its brief and its owner, stacked on another proposal item (or on nothing). */
export interface ProposalItem {
  key: string;
  kind: "proposal";
  title: string;
  brief: string;
  owner: string;
  /** The body sections it draws on, by heading. */
  cites: string[];
  /** The proposal item it is stacked on; absent = the previous proposal item, null = none. */
  stackedOn?: string | null;
  /**
   * An existing proposal the roadmap takes in as it is (adopted): nothing is created for it and
   * it needs no approvals — it has its own page; an establishment links its number at once.
   */
  proposal?: number;
}

/** A roadmap the roadmap derives: its brief and the employees who discuss it (the first moderates). */
export interface RoadmapItem {
  key: string;
  kind: "roadmap";
  title: string;
  brief: string;
  employees: string[];
  cites: string[];
}

export type DraftItem = ProposalItem | RoadmapItem;

/** One employee's session cloned for the room. */
export interface Clone {
  agentId: string;
  sessionId: string;
  openedAt: string;
  closedAt?: string;
}

/** Who approved a proposal item, and when. */
export interface Approval {
  by: string;
  at: string;
}

/** The two approvals a proposal item needs; the second creates its proposal. */
export type ApprovalRole = "person" | "moderator";

/**
 * What an establishment did with one item. A proposal item is established as a **brief**
 * (`stage: "brief"`): nothing is created for it and its owner is not told, until a person and the
 * moderator have both approved that brief. Then its owner is told (`stage: "delegated"`). A
 * roadmap item derives its roadmap at once (`stage: "delegated"`). A line written before the
 * gate existed has no stage and reads as delegated.
 */
export interface Delegation {
  key: string;
  owner: string;
  brief: string;
  /** The item key its proposal is stacked on (proposal items). */
  base: string | null;
  /** The derived roadmap's number (roadmap items). */
  child: number | null;
  delivered: boolean;
  error?: string;
  /** The proposal number linked back. */
  proposal?: number;
  stage: "brief" | "delegated";
  /** The approvals of the brief as it stands; a changed brief starts again with none. */
  approvals: Partial<Record<ApprovalRole, Approval>>;
}

export interface RoadmapEvent {
  seq: number;
  at: string;
  by: string;
  kind: LedgerEntry["kind"];
  note?: string;
}

export interface Roadmap {
  number: number;
  name: string;
  brief: string;
  channelId: string | null;
  /** The employees it was opened with, in order: the first moderates. */
  employees: string[];
  parent: number | null;
  parentItem: string | null;
  status: RoadmapStatus;
  record: string;
  body: string;
  items: DraftItem[];
  clones: Clone[];
  delegations: Record<string, Delegation>;
  createdBy: string;
  createdAt: string;
  events: RoadmapEvent[];
}

export type LedgerEntry =
  | {
      kind: "opened";
      number: number;
      name: string;
      brief: string;
      channelId: string | null;
      employees: string[];
      parent: number | null;
      parentItem?: string;
      by: string;
    }
  | { kind: "room"; number: number; channelId: string; by: string }
  | {
      kind: "draft";
      number: number;
      record?: string;
      body?: string;
      items?: DraftItem[];
      by: string;
    }
  | { kind: "established"; number: number; by: string }
  | {
      kind: "delegated";
      number: number;
      key: string;
      owner: string;
      brief: string;
      base: string | null;
      child: number | null;
      delivered: boolean;
      error?: string;
      by: string;
    }
  | {
      kind: "briefed";
      number: number;
      key: string;
      owner: string;
      brief: string;
      base: string | null;
      by: string;
    }
  | {
      kind: "approved";
      number: number;
      key: string;
      role: ApprovalRole;
      /** The brief approved: an approval counts only for the brief it was given to. */
      brief: string;
      by: string;
    }
  | { kind: "linked"; number: number; key: string; proposal: number; by: string }
  /** An existing proposal taken in as a proposal item (appended to the items as they stand). */
  | { kind: "adopted"; number: number; item: ProposalItem; by: string }
  | { kind: "reopened"; number: number; reason: string; by: string }
  | { kind: "renamed"; number: number; name: string; by: string }
  | { kind: "clone"; number: number; agentId: string; sessionId: string; by: string }
  | {
      kind: "clone_closed";
      number: number;
      agentId: string;
      sessionId: string;
      reason: string;
      by: string;
    }
  | { kind: "notify_failed"; number: number; agentId: string; error: string; by: string };

/** One line of the ledger; `seq` and `at` are the ledger's, everything else the write's. */
export type LedgerLine = { seq: number; at: string } & LedgerEntry;

export interface LedgerState {
  roadmaps: Map<number, Roadmap>;
  lastSeq: number;
}

const KINDS = new Set<LedgerEntry["kind"]>([
  "opened",
  "room",
  "draft",
  "established",
  "delegated",
  "briefed",
  "approved",
  "linked",
  "adopted",
  "reopened",
  "renamed",
  "clone",
  "clone_closed",
  "notify_failed",
]);

export function emptyState(): LedgerState {
  return { roadmaps: new Map(), lastSeq: 0 };
}

/** The lines of a ledger file; a line that is not one (bad JSON, unknown kind, no number) is skipped and counted. */
export function parseLedger(text: string): { lines: LedgerLine[]; skipped: number } {
  const lines: LedgerLine[] = [];
  let skipped = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    const o = v as Record<string, unknown> | null;
    if (
      o === null ||
      typeof o !== "object" ||
      typeof o.seq !== "number" ||
      typeof o.at !== "string" ||
      typeof o.number !== "number" ||
      typeof o.by !== "string" ||
      !KINDS.has(o.kind as LedgerEntry["kind"])
    ) {
      skipped++;
      continue;
    }
    lines.push(o as unknown as LedgerLine);
  }
  return { lines, skipped };
}

function noteOf(line: LedgerLine): string | undefined {
  switch (line.kind) {
    case "opened":
      return line.channelId ?? undefined;
    case "room":
      return line.channelId;
    case "delegated":
      return line.child !== null
        ? `${line.key} → roadmap #${line.child}`
        : `${line.key} → ${line.owner}`;
    case "briefed":
      return `${line.key}: brief (${line.owner})`;
    case "approved":
      return `${line.key}: ${line.role} ${line.by}`;
    case "linked":
      return `${line.key} → proposal #${line.proposal}`;
    case "adopted":
      return `${line.item?.key ?? "?"} ← proposal #${line.item?.proposal ?? "?"}`;
    case "reopened":
      return line.reason;
    case "renamed":
      return line.name;
    case "clone":
    case "clone_closed":
      return `${line.agentId} ${line.sessionId}`;
    case "notify_failed":
      return `${line.agentId}: ${line.error}`;
    default:
      return undefined;
  }
}

/** Applies one line to the state. A line about a roadmap that was never opened is ignored. */
export function applyLine(state: LedgerState, line: LedgerLine): void {
  state.lastSeq = Math.max(state.lastSeq, line.seq);
  if (line.kind === "opened") {
    state.roadmaps.set(line.number, {
      number: line.number,
      name: line.name,
      brief: line.brief,
      channelId: line.channelId,
      employees: [...line.employees],
      parent: line.parent,
      parentItem: line.parentItem ?? null,
      status: line.channelId === null ? "awaiting_room" : "discussing",
      record: "",
      body: "",
      items: [],
      clones: [],
      delegations: {},
      createdBy: line.by,
      createdAt: line.at,
      events: [],
    });
  }
  const r = state.roadmaps.get(line.number);
  if (r === undefined) return;
  const note = noteOf(line);
  r.events.push({
    seq: line.seq,
    at: line.at,
    by: line.by,
    kind: line.kind,
    ...(note !== undefined ? { note } : {}),
  });
  switch (line.kind) {
    case "room":
      r.channelId = line.channelId;
      if (r.status === "awaiting_room") r.status = "discussing";
      break;
    case "draft":
      if (line.record !== undefined) r.record = line.record;
      if (line.body !== undefined) r.body = line.body;
      if (line.items !== undefined) r.items = line.items;
      break;
    case "established":
      r.status = "established";
      break;
    case "delegated": {
      const prior = r.delegations[line.key];
      r.delegations[line.key] = {
        key: line.key,
        owner: line.owner,
        brief: line.brief,
        base: line.base,
        child: line.child,
        delivered: line.delivered,
        ...(line.error !== undefined ? { error: line.error } : {}),
        // A re-delegation to the same owner keeps the proposal it already linked.
        ...(prior?.proposal !== undefined && prior.owner === line.owner
          ? { proposal: prior.proposal }
          : {}),
        stage: "delegated",
        // The approvals that opened it stay on the record (none before the gate existed).
        approvals: prior !== undefined && prior.brief === line.brief ? prior.approvals : {},
      };
      break;
    }
    case "briefed": {
      const prior = r.delegations[line.key];
      r.delegations[line.key] = {
        key: line.key,
        owner: line.owner,
        brief: line.brief,
        base: line.base,
        child: null,
        delivered: false,
        ...(prior?.proposal !== undefined && prior.owner === line.owner
          ? { proposal: prior.proposal }
          : {}),
        stage: "brief",
        approvals: {},
      };
      break;
    }
    case "approved": {
      const d = r.delegations[line.key];
      if (d !== undefined && d.stage === "brief" && d.brief === line.brief)
        d.approvals[line.role] = { by: line.by, at: line.at };
      break;
    }
    case "linked": {
      const d = r.delegations[line.key];
      if (d !== undefined) d.proposal = line.proposal;
      break;
    }
    case "adopted":
      // A line without an item is passed over, like any line the fold cannot read.
      if (typeof line.item?.key !== "string") break;
      r.items = [...r.items.filter((x) => x.key !== line.item.key), { ...line.item }];
      break;
    case "reopened":
      r.status = "discussing";
      break;
    case "renamed":
      r.name = line.name;
      break;
    case "clone":
      r.clones.push({ agentId: line.agentId, sessionId: line.sessionId, openedAt: line.at });
      break;
    case "clone_closed": {
      const c = r.clones.find((x) => x.sessionId === line.sessionId && x.closedAt === undefined);
      if (c !== undefined) c.closedAt = line.at;
      break;
    }
    default:
      break;
  }
}

export function foldLedger(lines: readonly LedgerLine[]): LedgerState {
  const state = emptyState();
  for (const line of lines) applyLine(state, line);
  return state;
}

/**
 * One organization's ledger in memory, over its file: loaded once, appended under a promise
 * chain so two writes never interleave, the state updated only once the line is on disk.
 */
export class Ledger {
  private state: LedgerState = emptyState();
  private loaded: Promise<void> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly now: () => number = () => Date.now(),
    private readonly log: (line: string) => void = () => {},
  ) {}

  load(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = (async () => {
        let text = "";
        try {
          text = await fs.readFile(this.file, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        const { lines, skipped } = parseLedger(text);
        if (skipped > 0) this.log(`[company-roadmaps] ${this.file}: ${skipped} line(s) skipped`);
        this.state = foldLedger(lines);
      })();
    }
    return this.loaded;
  }

  roadmaps(): Roadmap[] {
    return [...this.state.roadmaps.values()].sort((a, b) => a.number - b.number);
  }

  get(number: number): Roadmap | undefined {
    return this.state.roadmaps.get(number);
  }

  nextNumber(): number {
    let max = 0;
    for (const n of this.state.roadmaps.keys()) max = Math.max(max, n);
    return max + 1;
  }

  /** Appends one line — assigned the next `seq` and the current time — and applies it once written. */
  append(entry: LedgerEntry): Promise<LedgerLine> {
    const run = this.chain.then(async () => {
      const line = {
        seq: this.state.lastSeq + 1,
        at: new Date(this.now()).toISOString(),
        ...entry,
      } as LedgerLine;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, `${JSON.stringify(line)}\n`, "utf8");
      applyLine(this.state, line);
      return line;
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
