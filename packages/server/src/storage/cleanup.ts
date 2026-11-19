/**
 * The Storage page's cleanup: review what can be removed safely, then remove what the user chose.
 *
 * What is offered, and when (spec 05 「存储空间」):
 * - A Session's scratchpad `scratchpad/<sessionId>/`:
 *   - orphan — no index row names the Session, the Trace index holds no file of it (a Trace with
 *     no row is adopted at the next start, so it is not an orphan), and nothing under the folder
 *     changed for a day. Ticked to begin with.
 *   - idle — the Session exists, is not in use, and was last active more than the days asked.
 *     Not ticked: its chat's attached images stop showing, and a continued chat loses the plans,
 *     hand-off files and attachments the model kept there.
 * - A temporary Workspace `workspaces/<name>/`: orphans only — no Session of any Project, archived
 *   or not, has it (or a folder inside it) as its Workspace, compared as written and by realpath,
 *   and nothing under it changed for a day (the evaluation Skill makes a Test Workspace before its
 *   Session exists). A Workspace a Session still has is never offered: without it that chat can
 *   never continue (`workspace_missing`); deleting the chat is what frees it. Ticked.
 * - Each entry of a cache location (./layout.ts) its own check allows.
 *
 * Removal judges every item again by the same rule, then — in one synchronous step with that
 * judgement, so no Task can start in between — moves the folder aside in one rename
 * (./cleanup-items.ts trashFor). A Task that starts afterwards finds the folder gone and makes a
 * new one; it never writes into a folder being purged. The contents are removed in the
 * background through the shared throttle, and the units measured again once they are.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  StorageCleanupItem,
  StorageCleanupRequest,
  StorageCleanupResult,
  StorageCleanupReview,
  StorageCleanupSkipReason,
} from "../api/storage-types.js";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { SessionRow } from "@prismshadow/penguin-library-session/repos/sessions";
import type { SessionCategory, TraceIndexStore } from "@prismshadow/penguin-library-trace";
import { agentDir, isValidId, workspacesDir } from "@prismshadow/penguin-core";
import { badRequest } from "../http/errors.js";
import type { FsLimiter } from "../services/tree-purge.js";
import { purgeTree } from "../services/tree-purge.js";
import { CACHE_TRASH, itemId, itemPath, parseItemId, trashFor } from "./cleanup-items.js";
import type { ItemRef } from "./cleanup-items.js";
import { cacheLocations } from "./layout.js";
import type { CacheGuards } from "./layout.js";
import type { StorageCaller, StorageUsageService } from "./usage.js";
import type { TreeSize } from "./tree-size.js";

/** How long an orphan's folder must have been left alone before it is offered. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** A review measures again when its figures are older than this. */
export const REVIEW_MAX_AGE_MS = 60_000;
export const IDLE_DAYS_DEFAULT = 7;
export const IDLE_DAYS_MAX = 3650;
/** Items one removal may name. */
export const CLEANUP_BATCH_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the cleanup reaches. */
export interface StorageCleanupDeps {
  root: string;
  usage: Pick<StorageUsageService, "fresh" | "remeasureAfter" | "projectFigures" | "serverFigures">;
  /** The session runtime's checks (Sessions.sessionInUse / agentInUse). */
  manager: { sessionInUse(sessionId: string): boolean } & CacheGuards;
  sessions: Pick<SessionIndex, "findById" | "listByProject">;
  /** Every Project the index holds: each one's rows are read for the Workspaces they point at. */
  allProjectIds(): string[];
  traceStore: Pick<TraceIndexStore, "listFilesBySession">;
  /** The listing rule's answer for a row (SessionService.listingOf): null for a subagent or desk. */
  listingOf(row: SessionRow): Promise<SessionCategory | null>;
  canAccess(userId: string, projectId: string): boolean;
  /** A Project's display name (its id when it has none). */
  projectName(projectId: string): Promise<string>;
  limiter: FsLimiter;
  signal: AbortSignal;
  /** Wall clock, ms. */
  now(): number;
  log(line: string): void;
}

/** The order the review lists its items in, before size. */
const KIND_ORDER = [
  "scratchpad:orphan",
  "scratchpad:idle",
  "workspace",
  "agentCache",
  "serverCache",
];

const orderOf = (item: StorageCleanupItem): number =>
  KIND_ORDER.indexOf(item.kind === "scratchpad" ? `scratchpad:${item.reason}` : item.kind);

const iso = (ms: number): string | null => (ms > 0 ? new Date(ms).toISOString() : null);

/** A scratchpad's verdict: removable as an orphan, as an idle Session's (with its row), or not. */
type ScratchpadVerdict = { reason: "orphan" } | { reason: "idle"; row: SessionRow } | null;

/** Parses the idle age a request asks for: a whole number of days, 1–3650. */
export function parseIdleDays(raw: unknown): number {
  if (raw === undefined) return IDLE_DAYS_DEFAULT;
  const days = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > IDLE_DAYS_MAX) {
    throw badRequest(
      `olderThanDays must be a whole number of days between 1 and ${IDLE_DAYS_MAX}.`,
    );
  }
  return days;
}

export class StorageCleanupService {
  constructor(private readonly deps: StorageCleanupDeps) {}

  /**
   * Every Workspace path a Session of any Project holds, resolved. Read synchronously from the
   * index, so a removal can read it in the same step as its rename.
   */
  private workspaceRefs(): string[] {
    const refs: string[] = [];
    for (const projectId of this.deps.allProjectIds()) {
      for (const row of this.deps.sessions.listByProject(projectId)) {
        const workspace = row.workspace.trim();
        if (workspace !== "") refs.push(path.resolve(workspace));
      }
    }
    return refs;
  }

  /**
   * Whether a Session holds a Workspace folder: has it (`forms`: as written and by realpath), or
   * a folder inside it, as its Workspace — or the Agent's own folder or its `workspaces/`
   * (`holders`), whose contents are then that Session's files. A Workspace above the Agent's
   * folder (the home folder, the data root) does not hold the Agent's temporary Workspaces.
   */
  private static held(
    forms: readonly string[],
    holders: readonly string[],
    refs: readonly string[],
  ): boolean {
    return refs.some(
      (ref) =>
        holders.includes(ref) ||
        forms.some(
          (form) =>
            ref === form || ref.startsWith(form.endsWith(path.sep) ? form : form + path.sep),
        ),
    );
  }

  private judgeScratchpad(
    projectId: string,
    agentId: string,
    sessionId: string,
    size: TreeSize,
    idleDays: number,
    now: number,
  ): ScratchpadVerdict {
    if (!isValidId(sessionId)) return null;
    const row = this.deps.sessions.findById(sessionId);
    if (row === null) {
      if (this.deps.traceStore.listFilesBySession(projectId, agentId, sessionId).length > 0) {
        return null;
      }
      return now - size.newestMs >= ORPHAN_GRACE_MS ? { reason: "orphan" } : null;
    }
    // A Session of another Agent that happens to share the id is not this folder's.
    if (row.projectId !== projectId || row.agentId !== agentId) return null;
    if (this.deps.manager.sessionInUse(sessionId)) return null;
    const lastActive = Date.parse(row.lastActiveAt);
    if (!(lastActive < now - idleDays * DAY_MS)) return null;
    return { reason: "idle", row };
  }

  /** The forms a folder is compared in: as written, and its realpath when it resolves. */
  private static async forms(abs: string): Promise<string[]> {
    const forms = [path.resolve(abs)];
    const real = await fsp.realpath(abs).catch(() => null);
    if (real !== null && real !== forms[0]) forms.push(real);
    return forms;
  }

  /** A Workspace folder's forms, and its Agent's folders that would hold it (see held). */
  private async workspaceForms(
    projectId: string,
    agentId: string,
    abs: string,
  ): Promise<{ forms: string[]; holders: string[] }> {
    const own = agentDir(this.deps.root, projectId, agentId);
    const holders = [
      ...(await StorageCleanupService.forms(own)),
      ...(await StorageCleanupService.forms(workspacesDir(this.deps.root, projectId, agentId))),
    ];
    return { forms: await StorageCleanupService.forms(abs), holders };
  }

  /** The figures of the units in the caller's scope, measured at most a minute ago. */
  async review(caller: StorageCaller, idleDays: number): Promise<StorageCleanupReview> {
    const snapshot = await this.deps.usage.fresh(caller, REVIEW_MAX_AGE_MS);
    const now = this.deps.now();
    const refs = this.workspaceRefs();
    const items: StorageCleanupItem[] = [];
    for (const [projectId, figures] of snapshot.projects) {
      const projectName = await this.deps.projectName(projectId);
      const readable = this.deps.canAccess(caller.userId, projectId);
      for (const agent of figures.agents.values()) {
        const where = {
          projectId,
          projectName,
          agentId: agent.agentId,
          agentName: figures.agentNames.get(agent.agentId) ?? agent.agentId,
        };
        for (const [name, size] of agent.scratchpads) {
          const verdict = this.judgeScratchpad(projectId, agent.agentId, name, size, idleDays, now);
          if (verdict === null) continue;
          // A subagent's or a desk's scratchpad goes with the Session it belongs to.
          if (verdict.reason === "idle" && (await this.deps.listingOf(verdict.row)) === null)
            continue;
          const ref: ItemRef = { kind: "scratchpad", projectId, agentId: agent.agentId, name };
          items.push({
            id: itemId(ref),
            kind: "scratchpad",
            reason: verdict.reason,
            ...where,
            ...(verdict.reason === "idle"
              ? {
                  sessionId: name,
                  ...(readable ? { title: verdict.row.title } : {}),
                  lastActiveAt: verdict.row.lastActiveAt,
                }
              : {}),
            name,
            bytes: size.bytes,
            lastModifiedAt: iso(size.newestMs),
            selected: verdict.reason === "orphan",
          });
        }
        for (const [name, size] of agent.workspaces) {
          if (now - size.newestMs < ORPHAN_GRACE_MS) continue;
          const abs = path.join(workspacesDir(this.deps.root, projectId, agent.agentId), name);
          const { forms, holders } = await this.workspaceForms(projectId, agent.agentId, abs);
          if (StorageCleanupService.held(forms, holders, refs)) continue;
          const ref: ItemRef = { kind: "workspace", projectId, agentId: agent.agentId, name };
          items.push({
            id: itemId(ref),
            kind: "workspace",
            reason: "orphan",
            ...where,
            name,
            bytes: size.bytes,
            lastModifiedAt: iso(size.newestMs),
            selected: true,
          });
        }
        for (const location of cacheLocations("agent")) {
          for (const [name, size] of agent.caches.get(location.key) ?? []) {
            if (name === CACHE_TRASH) continue;
            if (location.inUse(this.deps.manager, { projectId, agentId: agent.agentId, name })) {
              continue;
            }
            const ref: ItemRef = {
              kind: "agentCache",
              projectId,
              agentId: agent.agentId,
              location,
              name,
            };
            items.push({
              id: itemId(ref),
              kind: "agentCache",
              reason: "idle",
              ...where,
              name,
              bytes: size.bytes,
              lastModifiedAt: iso(size.newestMs),
              selected: location.selected,
            });
          }
        }
      }
    }
    if (snapshot.server !== null) {
      for (const location of cacheLocations("server")) {
        for (const [name, size] of snapshot.server.caches.get(location.key) ?? []) {
          if (name === CACHE_TRASH || location.inUse(this.deps.manager, { name })) continue;
          const ref: ItemRef = { kind: "serverCache", location, name };
          items.push({
            id: itemId(ref),
            kind: "serverCache",
            reason: "idle",
            name,
            bytes: size.bytes,
            lastModifiedAt: iso(size.newestMs),
            selected: location.selected,
          });
        }
      }
    }
    items.sort((a, b) => orderOf(a) - orderOf(b) || b.bytes - a.bytes || (a.id < b.id ? -1 : 1));
    return {
      measuredAt: new Date(snapshot.measuredAt).toISOString(),
      olderThanDays: idleDays,
      items,
    };
  }

  /** Whether the caller may clean `ref`: their Projects' Agents; an admin anything. */
  private allowed(caller: StorageCaller, ref: ItemRef): boolean {
    if (caller.isAdmin) return true;
    return ref.kind !== "serverCache" && this.deps.canAccess(caller.userId, ref.projectId);
  }

  /** What the last measurement saw of `ref`; null when it saw nothing there. */
  private measured(ref: ItemRef): TreeSize | null {
    if (ref.kind === "serverCache") {
      return this.deps.usage.serverFigures()?.caches.get(ref.location.key)?.get(ref.name) ?? null;
    }
    const agent = this.deps.usage.projectFigures(ref.projectId)?.agents.get(ref.agentId);
    if (agent === undefined) return null;
    if (ref.kind === "scratchpad") return agent.scratchpads.get(ref.name) ?? null;
    if (ref.kind === "workspace") return agent.workspaces.get(ref.name) ?? null;
    return agent.caches.get(ref.location.key)?.get(ref.name) ?? null;
  }

  /**
   * Removes what `request` names, each judged again by the review's rule: what no longer passes
   * is skipped and said why. Answers once every folder that passed is moved aside; their contents
   * are removed in the background.
   */
  async remove(
    caller: StorageCaller,
    request: StorageCleanupRequest,
  ): Promise<StorageCleanupResult> {
    const now = this.deps.now();
    const skipped: StorageCleanupResult["skipped"] = [];
    /** An item that passed the checks that may wait: its final judgement runs with the rename. */
    interface Planned {
      id: string;
      ref: ItemRef;
      abs: string;
      size: TreeSize;
      forms: string[];
      holders: string[];
      /** A scratchpad's Session is in a list (or has no row): only then may an idle one go. */
      listed: boolean;
      trash: { dir: string; path: string };
    }
    const planned: Planned[] = [];
    for (const id of new Set(request.items)) {
      const ref = parseItemId(id);
      const size = ref === null ? null : this.measured(ref);
      // An item this caller may not clean reads as one that is not there: an id never says
      // whether another Project's folder exists.
      if (ref === null || size === null || !this.allowed(caller, ref)) {
        skipped.push({ id, reason: "gone" });
        continue;
      }
      const abs = itemPath(this.deps.root, ref);
      const { forms, holders } =
        ref.kind === "workspace"
          ? await this.workspaceForms(ref.projectId, ref.agentId, abs)
          : { forms: [], holders: [] };
      const row = ref.kind === "scratchpad" ? this.deps.sessions.findById(ref.name) : null;
      const listed = row === null || (await this.deps.listingOf(row)) !== null;
      const trash = trashFor(this.deps.root, ref, now);
      await fsp.mkdir(trash.dir, { recursive: true });
      planned.push({ id, ref, abs, size, forms, holders, listed, trash });
    }

    // From here to the last rename nothing awaits: each judgement and its rename happen with no
    // Task able to start in between.
    const refs = this.workspaceRefs();
    const moved: Planned[] = [];
    for (const plan of planned) {
      const verdict = this.judgeNow(plan, refs, request.olderThanDays, now);
      if (verdict !== null) {
        skipped.push({ id: plan.id, reason: verdict });
        continue;
      }
      try {
        fs.renameSync(plan.abs, plan.trash.path);
        moved.push(plan);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          skipped.push({ id: plan.id, reason: "gone" });
        } else {
          skipped.push({ id: plan.id, reason: "failed" });
          this.deps.log(`[storage] could not move ${plan.abs} aside: ${(err as Error).message}`);
        }
      }
    }

    const purged = this.purge(moved.map((plan) => plan.trash.path));
    const projects = new Set<string>();
    let server = false;
    for (const plan of moved) {
      if (plan.ref.kind === "serverCache") server = true;
      else projects.add(plan.ref.projectId);
    }
    if (moved.length > 0) this.deps.usage.remeasureAfter([...projects], server, purged);
    return {
      removed: moved.length,
      bytes: moved.reduce((sum, plan) => sum + plan.size.bytes, 0),
      skipped,
    };
  }

  /** The review's rule for one item, read synchronously: null when it may go now. */
  private judgeNow(
    item: {
      ref: ItemRef;
      abs: string;
      size: TreeSize;
      forms: readonly string[];
      holders: readonly string[];
      listed: boolean;
    },
    refs: readonly string[],
    idleDays: number,
    now: number,
  ): StorageCleanupSkipReason | null {
    const { ref, abs, size } = item;
    switch (ref.kind) {
      case "scratchpad": {
        const verdict = this.judgeScratchpad(
          ref.projectId,
          ref.agentId,
          ref.name,
          size,
          idleDays,
          now,
        );
        if (verdict === null) return "in_use";
        if (verdict.reason === "idle") return item.listed ? null : "in_use";
        // An orphan written into since it was measured (a process this server does not know of)
        // is young again.
        try {
          return now - fs.lstatSync(abs).mtimeMs >= ORPHAN_GRACE_MS ? null : "in_use";
        } catch {
          return "gone";
        }
      }
      case "workspace": {
        if (StorageCleanupService.held(item.forms, item.holders, refs)) return "in_use";
        // Something written into it since it was measured makes it young again.
        let changed = size.newestMs;
        try {
          changed = Math.max(changed, fs.lstatSync(abs).mtimeMs);
        } catch {
          return "gone";
        }
        return now - changed >= ORPHAN_GRACE_MS ? null : "in_use";
      }
      case "agentCache":
        return ref.location.inUse(this.deps.manager, ref) ? "in_use" : null;
      case "serverCache":
        return ref.location.inUse(this.deps.manager, ref) ? "in_use" : null;
    }
  }

  /** Removes each moved folder's contents, one after another; resolves when all are done. */
  private async purge(trashes: readonly string[]): Promise<void> {
    for (const trash of trashes) {
      if (this.deps.signal.aborted) return;
      const failure = await purgeTree(trash, {
        limiter: this.deps.limiter,
        signal: this.deps.signal,
      }).catch((err: unknown) => ({ failed: 1, error: (err as Error).message }));
      // What is left stays in the trash, which the next start removes (agents/.deleting/), or
      // the next purge of this location's trash does (resumePurges).
      if (failure !== null) this.deps.log(`[storage] ${trash}: ${failure.error}`);
    }
  }

  /**
   * Removes what an earlier process left in the server cache locations' trash. (What it left in
   * a Project's `agents/.deleting/` the Agent service resumes at every start.)
   */
  async resumePurges(): Promise<void> {
    for (const location of cacheLocations("server")) {
      const dir = path.join(location.dir(this.deps.root), CACHE_TRASH);
      let names: string[] = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      await this.purge(names.map((name) => path.join(dir, name)));
    }
  }
}
