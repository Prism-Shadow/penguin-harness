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
import { locateQuote, paragraphAtOffset, paragraphSpan, sectionSource } from "./comments.js";
import type {
  ProposalComment,
  ProposalEvent,
  ProposalMaterial,
  ProposalMaterialKind,
  ProposalRevision,
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
      /** The principal that started it: `user:<id>` or `agent:<id>` (a bare user id in lines written before principals were recorded). */
      delegatedBy: string;
      brief: string;
    }
  | {
      kind: "revised";
      number: number;
      revision: number;
      title: string;
      /** The repository's directory in the shared workspace; absent = "" (the workspace itself). */
      root?: string;
      /** Every entry carries its `kind` (ledgers written before kinds are migrated on load — see migrateScopeKinds). */
      scope: ProposalScopeEntry[];
      sections: ProposalSection[];
      by: string;
    }
  /**
   * A status change. An `approved` line carries the `revision` it covers (lines written
   * before that field read as the revision current when they were written).
   */
  | {
      kind: "status";
      number: number;
      status: ProposalStatus;
      by: string;
      reason?: string;
      revision?: number;
    }
  | { kind: "implementation"; number: number; implementer: string; sessionId: string; by: string }
  | {
      kind: "material";
      number: number;
      material: { kind: ProposalMaterialKind; label: string; url: string };
      by: string;
    }
  | { kind: "feedback"; number: number; text: string; runtime: boolean; by: string }
  /**
   * A pending comment: the person's own until a `batch` line names it. Anchored to
   * `[start, end)` of `sectionId`'s source at `revision`, with the passage as `quote` (what
   * re-anchors it after a revision). Lines written before ranges name a `paragraphId`
   * instead; the fold anchors those to the whole paragraph (see applyLine).
   */
  | {
      kind: "comment";
      number: number;
      id: string;
      sectionId?: string;
      start?: number;
      end?: number;
      quote?: string;
      /** The pre-range form: the paragraph the comment stood on. */
      paragraphId?: string;
      revision: number;
      text: string;
      by: string;
    }
  /** A pending comment reworded, or withdrawn, by the person who wrote it — its own until sent, so neither is an event. */
  | { kind: "comment_edited"; number: number; commentId: string; text: string; by: string }
  | { kind: "comment_deleted"; number: number; commentId: string; by: string }
  /**
   * A request for changes: the pending comments it gathers, in one batch, and the `revision`
   * they were written against (a line written before that field reads as the revision current
   * when it was written) — the author's `ready` is refused until a later revision is out and
   * every comment of the batch is resolved.
   */
  | {
      kind: "batch";
      number: number;
      id: string;
      commentIds: string[];
      by: string;
      revision?: number;
    }
  | { kind: "resolved"; number: number; commentId: string; text: string; by: string }
  /** A channel message the plugin had to send did not go out: to whom, and why. */
  | { kind: "notify_failed"; number: number; reason: string; target: string[]; by: string };

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
  /** The scope's root at the head revision ("" = the shared workspace). */
  root: string;
  scope: ProposalScopeEntry[];
  sections: ProposalSection[];
  materials: ProposalMaterial[];
  sessions: string[];
  comments: ProposalComment[];
  events: ProposalEvent[];
  /** The batches of requested changes since the last `ready` (or creation): what the author's next `ready` must have answered. */
  openBatches: Array<{ id: string; revision: number; commentIds: string[] }>;
  /** The revision the standing approval covers; null until approved. Kept across a later publish (the status is not). */
  approvedRevision: number | null;
  /** Every revision as published, by number — what a diff against the approved one reads. */
  revisions: Map<number, ProposalRevision>;
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
    // Lines written before principals were recorded carry a bare user id.
    const delegatedBy = line.delegatedBy.includes(":")
      ? line.delegatedBy
      : `user:${line.delegatedBy}`;
    state.proposals.set(line.number, {
      number: line.number,
      title: line.title,
      status: "drafting",
      revision: 0,
      author: line.author,
      implementer: null,
      delegatedBy,
      brief: line.brief,
      createdAt: line.at,
      updatedAt: line.at,
      root: "",
      scope: [],
      sections: [],
      materials: [],
      sessions: [],
      comments: [],
      openBatches: [],
      events: [{ seq: line.seq, at: line.at, kind: "created", by: delegatedBy }],
      approvedRevision: null,
      revisions: new Map(),
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
      p.root = line.root ?? "";
      p.scope = line.scope;
      p.sections = line.sections;
      p.revisions.set(line.revision, {
        revision: line.revision,
        title: line.title,
        root: line.root ?? "",
        scope: line.scope,
        sections: line.sections,
        by: line.by,
        at: line.at,
      });
      // An approval covers one revision: the text it was given for is no longer the head, so
      // the proposal is back to ready — the approved revision stays recorded for the diff.
      if (p.status === "approved") p.status = "ready";
      // Every comment follows its passage into the new text; one whose passage is gone keeps
      // the revision it was last found in and is listed as a comment on that revision.
      for (const c of p.comments) reanchor(c, p.sections, p.revision);
      event("revised", line.by, { text: line.title, revision: line.revision });
      return;
    case "status":
      p.status = line.status;
      if (line.status === "ready") {
        // A ready answers every batch before it.
        p.openBatches = [];
        event("ready", line.by, line.reason !== undefined ? { text: line.reason } : {});
      } else if (line.status === "approved") {
        p.approvedRevision = line.revision ?? p.revision;
        event("approved", line.by, { revision: p.approvedRevision });
      } else if (line.status === "merged") event("merged", line.by);
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
    case "comment": {
      const anchor = commentAnchor(line, p.sections);
      p.comments.push({
        id: line.id,
        ...anchor,
        // A passage that is not in the current text is a comment on the revision it names.
        revision: anchor.paragraphId === undefined ? line.revision : p.revision,
        text: line.text,
        by: line.by,
        at: line.at,
        batchId: null,
      });
      return;
    }
    case "comment_edited": {
      const c = p.comments.find((x) => x.id === line.commentId);
      if (c !== undefined && c.batchId === null) c.text = line.text;
      return;
    }
    case "comment_deleted": {
      const at = p.comments.findIndex((x) => x.id === line.commentId && x.batchId === null);
      if (at >= 0) p.comments.splice(at, 1);
      return;
    }
    case "batch": {
      const ids = new Set(line.commentIds);
      for (const c of p.comments) if (ids.has(c.id)) c.batchId = line.id;
      p.openBatches.push({
        id: line.id,
        revision: line.revision ?? p.revision,
        commentIds: [...line.commentIds],
      });
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
    case "notify_failed":
      event("notify_failed", line.by, { text: line.reason });
      return;
  }
}

/**
 * A comment line's anchor in the sections current at that line. A range line anchors as
 * written (its paragraph derived); a paragraph line — the pre-range form, in ledgers written
 * before ranges — anchors to the whole paragraph when the current text still has it, and to
 * nothing otherwise. Legacy handling to keep until every organization's ledger predates no
 * range line, i.e. indefinitely cheap: one branch, no migration.
 */
function commentAnchor(
  line: Extract<LedgerEntry, { kind: "comment" }>,
  sections: readonly ProposalSection[],
): Pick<ProposalComment, "sectionId" | "range" | "quote" | "paragraphId"> {
  if (line.sectionId !== undefined && line.start !== undefined && line.end !== undefined) {
    const section = sections.find((s) => s.id === line.sectionId);
    const paragraphId = section === undefined ? null : paragraphAtOffset(section, line.start);
    return {
      sectionId: line.sectionId,
      range: { start: line.start, end: line.end },
      quote:
        line.quote ??
        (section === undefined ? "" : sectionSource(section).slice(line.start, line.end)),
      ...(paragraphId === null ? {} : { paragraphId }),
    };
  }
  const paragraphId = line.paragraphId ?? "";
  for (const section of sections) {
    const span = paragraphSpan(section, paragraphId);
    if (span === null) continue;
    return {
      sectionId: section.id,
      range: span,
      quote: sectionSource(section).slice(span.start, span.end),
      paragraphId,
    };
  }
  return { sectionId: "", range: { start: 0, end: 0 }, quote: "" };
}

/** Moves a comment to where its quote now stands; a quote not found leaves it on its last revision, paragraph-less. */
function reanchor(
  c: ProposalComment,
  sections: readonly ProposalSection[],
  revision: number,
): void {
  const section = sections.find((s) => s.id === c.sectionId);
  const found = section === undefined ? null : locateQuote(sectionSource(section), c.quote);
  if (section === undefined || found === null) {
    delete c.paragraphId;
    return;
  }
  c.range = found;
  c.revision = revision;
  const paragraphId = paragraphAtOffset(section, found.start);
  if (paragraphId === null) delete c.paragraphId;
  else c.paragraphId = paragraphId;
}

/** The pure fold: the lines, in file order, to the state they describe. */
export function foldLedger(lines: Iterable<LedgerLine>): LedgerState {
  const state = emptyState();
  for (const line of lines) applyLine(state, line);
  return state;
}

/**
 * The one-time migration of a ledger written before scope kinds: every `revised` line's scope
 * entries without a `kind` get `kind: "edit"` (what every such entry meant). Lines that need
 * nothing are returned as they were, byte for byte; a changed line is the same JSON with the
 * key added first in each entry. `changed` counts the entries given a kind — 0 means the text
 * is untouched and nothing is to be written.
 *
 * Backward compatibility (changelog/unreleased/2026-09-24-backward-compatibility.md): to be
 * removed once every data root that ran a pre-kind build has loaded one with this.
 */
export function migrateScopeKinds(text: string): { text: string; changed: number } {
  let changed = 0;
  const lines = text.split("\n").map((raw) => {
    if (!raw.includes('"revised"')) return raw;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return raw;
    }
    const line = value as { kind?: unknown; scope?: unknown };
    if (line.kind !== "revised" || !Array.isArray(line.scope)) return raw;
    let touched = false;
    line.scope = (line.scope as Array<Record<string, unknown>>).map((entry) => {
      if (typeof entry !== "object" || entry === null || "kind" in entry) return entry;
      touched = true;
      changed++;
      return { kind: "edit", ...entry };
    });
    return touched ? JSON.stringify(line) : raw;
  });
  return { text: changed === 0 ? text : lines.join("\n"), changed };
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
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** Replays the file (once), migrating a pre-kind ledger in place first (see migrateScopeKinds). */
  load(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = (async () => {
        let text = "";
        try {
          text = await fs.readFile(this.file, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        const migrated = migrateScopeKinds(text);
        if (migrated.changed > 0) {
          const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
          const backup = `${this.file}.before-scope-kinds-${stamp}.bak`;
          await fs.copyFile(this.file, backup);
          const temp = `${this.file}.migrating-${process.pid}`;
          await fs.writeFile(temp, migrated.text, "utf8");
          await fs.rename(temp, this.file);
          this.log(
            `[company-proposals] migrated ${migrated.changed} scope entries to kind "edit" in ${this.file} (backup ${backup})`,
          );
          text = migrated.text;
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
