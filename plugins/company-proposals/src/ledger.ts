/**
 * The ledger: one append-only JSON-lines file per organization,
 * `<root>/<projectId>/organizations/<orgId>/proposals.jsonl`, replayed into memory on first
 * use. The file is the plugin's own — the server is its only writer, the way `desks.toml`
 * is — and it is a file rather than a directory of files on purpose: where a proposal's body
 * comes from (an issue, an RFC in the repository) is the company's business; the ledger
 * records the copy that was sent in, and every comment, event and material that gathered
 * around it.
 *
 * `seq` numbers every line of an organization's ledger; a person's read position is a
 * `seq`, and "unread" is what came after it. `foldLedger` is pure — the same lines always
 * fold to the same proposals — so a restart, a hot update or a test replays the file and
 * stands where it stood.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProposalComment,
  ProposalEvent,
  ProposalMaterial,
  ProposalMaterialKind,
  ProposalScopeEntry,
  ProposalSection,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";

/** The file's name inside the organization directory. */
export const LEDGER_FILE = "proposals.jsonl";

/** Where an organization's ledger lives (the same layout organization/paths.ts composes). */
export function ledgerPath(root: string, projectId: string, orgId: string): string {
  return path.join(root, projectId, "organizations", orgId, LEDGER_FILE);
}

/** One line of the ledger; `seq` and `at` are the ledger's, everything else the write's. */
export type LedgerLine = { seq: number; at: string } & LedgerEntry;

export type LedgerEntry =
  | {
      kind: "created";
      number: number;
      title: string;
      author: string;
      delegatedBy: string;
      brief: string;
    }
  | {
      kind: "revised";
      number: number;
      revision: number;
      title: string;
      scope: ProposalScopeEntry[];
      sections: ProposalSection[];
      by: string;
    }
  | { kind: "status"; number: number; status: ProposalStatus; by: string; reason?: string }
  | { kind: "implementation"; number: number; implementer: string; sessionId: string; by: string }
  | {
      kind: "material";
      number: number;
      material: { kind: ProposalMaterialKind; label: string; url: string };
      by: string;
    }
  | { kind: "feedback"; number: number; text: string; runtime: boolean; by: string }
  /** A pending comment: the person's own until a `batch` line names it. */
  | {
      kind: "comment";
      number: number;
      id: string;
      paragraphId: string;
      revision: number;
      text: string;
      by: string;
    }
  /** A request for changes: the pending comments it gathers, in one batch. */
  | { kind: "batch"; number: number; id: string; commentIds: string[]; by: string }
  | { kind: "resolved"; number: number; commentId: string; text: string; by: string };

/** A proposal as the fold produces it: every fact the ledger holds about it, before any caller-specific view. */
export interface Proposal {
  number: number;
  title: string;
  status: ProposalStatus;
  revision: number;
  author: string;
  implementer: string | null;
  delegatedBy: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
  scope: ProposalScopeEntry[];
  sections: ProposalSection[];
  materials: ProposalMaterial[];
  sessions: string[];
  comments: ProposalComment[];
  events: ProposalEvent[];
  /** The `seq` of the last line about this proposal. */
  seq: number;
}

/** The fold of a whole ledger: its proposals by number, and the last `seq` written. */
export interface LedgerState {
  proposals: Map<number, Proposal>;
  lastSeq: number;
}

function emptyState(): LedgerState {
  return { proposals: new Map(), lastSeq: 0 };
}

/** Applies one line to the state; a line about a proposal the state has not got is skipped (a truncated file, never a crash). */
export function applyLine(state: LedgerState, line: LedgerLine): void {
  state.lastSeq = Math.max(state.lastSeq, line.seq);
  if (line.kind === "created") {
    state.proposals.set(line.number, {
      number: line.number,
      title: line.title,
      status: "drafting",
      revision: 0,
      author: line.author,
      implementer: null,
      delegatedBy: line.delegatedBy,
      brief: line.brief,
      createdAt: line.at,
      updatedAt: line.at,
      scope: [],
      sections: [],
      materials: [],
      sessions: [],
      comments: [],
      events: [{ seq: line.seq, at: line.at, kind: "created", by: `user:${line.delegatedBy}` }],
      seq: line.seq,
    });
    return;
  }
  const p = state.proposals.get(line.number);
  if (p === undefined) return;
  p.seq = line.seq;
  p.updatedAt = line.at;
  const event = (
    kind: ProposalEvent["kind"],
    by: string,
    extra: { text?: string; revision?: number } = {},
  ): void => {
    p.events.push({ seq: line.seq, at: line.at, kind, by, ...extra });
  };
  switch (line.kind) {
    case "revised":
      p.revision = line.revision;
      p.title = line.title;
      p.scope = line.scope;
      p.sections = line.sections;
      event("revised", line.by, { text: line.title, revision: line.revision });
      return;
    case "status":
      p.status = line.status;
      if (line.status === "ready") event("ready", line.by);
      else if (line.status === "approved") event("approved", line.by);
      else if (line.status === "merged") event("merged", line.by);
      else if (line.status === "rejected")
        event("rejected", line.by, line.reason !== undefined ? { text: line.reason } : {});
      return;
    case "implementation":
      p.implementer = line.implementer;
      p.sessions.push(line.sessionId);
      event("implementation_started", line.by, { text: line.implementer });
      return;
    case "material":
      p.materials.push({ ...line.material, by: line.by, at: line.at });
      event("material_added", line.by, { text: line.material.label });
      return;
    case "feedback":
      event(line.runtime ? "runtime_feedback" : "feedback", line.by, { text: line.text });
      return;
    case "comment":
      p.comments.push({
        id: line.id,
        paragraphId: line.paragraphId,
        revision: line.revision,
        text: line.text,
        by: line.by,
        at: line.at,
        batchId: null,
      });
      return;
    case "batch": {
      const ids = new Set(line.commentIds);
      for (const c of p.comments) if (ids.has(c.id)) c.batchId = line.id;
      // A request for changes puts a ready proposal back to the author's desk.
      if (p.status === "ready") p.status = "drafting";
      event("changes_requested", line.by, { text: String(line.commentIds.length) });
      return;
    }
    case "resolved": {
      const c = p.comments.find((x) => x.id === line.commentId);
      if (c !== undefined) c.resolved = { by: line.by, at: line.at, text: line.text };
      event("resolved", line.by, { text: line.text });
      return;
    }
  }
}

/** The pure fold: the lines, in file order, to the state they describe. */
export function foldLedger(lines: Iterable<LedgerLine>): LedgerState {
  const state = emptyState();
  for (const line of lines) applyLine(state, line);
  return state;
}

/** Parses the file's text; a line that is not JSON, or not a ledger line, is skipped. */
export function parseLedger(text: string): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { seq?: unknown }).seq === "number" &&
      typeof (value as { kind?: unknown }).kind === "string"
    ) {
      out.push(value as LedgerLine);
    }
  }
  return out;
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
  ) {}

  /** Replays the file (once). */
  load(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = (async () => {
        let text = "";
        try {
          text = await fs.readFile(this.file, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        this.state = foldLedger(parseLedger(text));
      })();
    }
    return this.loaded;
  }

  proposals(): Proposal[] {
    return [...this.state.proposals.values()];
  }

  get(number: number): Proposal | undefined {
    return this.state.proposals.get(number);
  }

  /** The next proposal number: one past the highest so far. */
  nextNumber(): number {
    let max = 0;
    for (const n of this.state.proposals.keys()) max = Math.max(max, n);
    return max + 1;
  }

  lastSeq(): number {
    return this.state.lastSeq;
  }

  /** Appends one line — assigned the next `seq` and the current time — and applies it once written. */
  append(entry: LedgerEntry): Promise<LedgerLine> {
    const run = this.chain.then(async () => {
      const line: LedgerLine = {
        seq: this.state.lastSeq + 1,
        at: new Date(this.now()).toISOString(),
        ...entry,
      };
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
