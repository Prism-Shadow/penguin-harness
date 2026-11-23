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
 * judgement, so no Task can start in between — moves the folder aside in one rename through the
 * host's deleting folders (`DeletingFolders.moveAside`, ./cleanup-items.ts placeFor). A Task that
 * starts afterwards finds the folder gone and makes a new one; it never writes into a folder
 * being purged. The host removes the contents in the background, and the units are measured
 * again once it has.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { isValidId } from "@prismshadow/penguin-core/plugin";
import { badRequest } from "@prismshadow/penguin-server/plugin";
import type {
  DataLayout,
  DeletingFolders,
  DeletingPlace,
  SessionActivity,
  SessionCategory,
  SessionIndex,
  SessionRow,
  TraceIndexStore,
} from "@prismshadow/penguin-server/plugin";
import type {
  StorageCleanupItem,
  StorageCleanupRequest,
  StorageCleanupResult,
  StorageCleanupReview,
  StorageCleanupSkipReason,
} from "../types.js";
import { itemId, itemPath, parseItemId, placeFor } from "./cleanup-items.js";
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
  layout: DataLayout;
  usage: Pick<StorageUsageService, "fresh" | "remeasureAfter" | "projectFigures" | "serverFigures">;
  /** The session runtime's in-use answers. */
  activity: Pick<SessionActivity, "sessionInUse"> & CacheGuards;
  /** Where a removed folder waits while the host removes its contents. */
  folders: Pick<DeletingFolders, "moveAside" | "purge" | "resume" | "deletingDirIn">;
  sessions: Pick<SessionIndex, "findById" | "listByProject">;
  /** Every Project the index holds: each one's rows are read for the Workspaces they point at. */
  allProjectIds(): string[];
  traceStore: Pick<TraceIndexStore, "listFilesBySession">;
  /** The listing rule's answer for a row (SessionService.listingOf): null for a subagent or desk. */
  listingOf(row: SessionRow): Promise<SessionCategory | null>;
  canAccess(userId: string, projectId: string): boolean;
  /** A Project's display name (its id when it has none). */
  projectName(projectId: string): Promise<string>;
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

/**
 * Resolves `abs` through any symbolic links or Windows junctions, falling back to the nearest
 * existing ancestor so references to a missing subdirectory under a linked Workspace still match.
 */
function realpathSyncOrAncestor(abs: string): string | null {
  let current = abs;
  const tail: string[] = [];
  const links = new Set<string>();
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      // A dangling link can still name a missing child of an existing Workspace. Resolve
      // its stored target before climbing further, retaining any suffix already stripped.
      let target: string | undefined;
      try {
        target = fs.readlinkSync(current);
      } catch {
        // Ordinary missing components have no link target.
      }
      if (target !== undefined) {
        if (links.has(current)) return null;
        links.add(current);
        current = path.resolve(path.dirname(current), target);
        continue;
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Whether a Session holds a Workspace folder: has it (`forms`: as written and by realpath), or
 * a folder inside it, as its Workspace — or the Agent's own folder or its `workspaces/`
 * (`holders`), whose contents are then that Session's files. A Workspace above the Agent's
 * folder (the home folder, the data root) does not hold the Agent's temporary Workspaces.
 * On Windows, path comparisons are case-insensitive.
 */
export function isWorkspaceHeld(
  forms: readonly string[],
  holders: readonly string[],
  refs: readonly string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  const sep = platform === "win32" ? "\\" : "/";
  const norm = (p: string) => (platform === "win32" ? p.toLowerCase() : p);
  const normHolders = holders.map(norm);
  const normForms = forms.map(norm);
  return refs.some((rawRef) => {
    const ref = norm(rawRef);
    return (
      normHolders.includes(ref) ||
      normForms.some(
        (form) => ref === form || ref.startsWith(form.endsWith(sep) ? form : form + sep),
      )
    );
  });
}

export class StorageCleanupService {
  constructor(private readonly deps: StorageCleanupDeps) {}

  /**
   * Every Workspace path a Session of any Project holds, as resolved and by realpath. Read
   * synchronously from the index, so a removal can read it in the same step as its rename.
   */
  private workspaceRefs(): string[] {
    const refs: string[] = [];
    const seen = new Set<string>();
    for (const projectId of this.deps.allProjectIds()) {
      for (const row of this.deps.sessions.listByProject(projectId)) {
        const workspace = row.workspace.trim();
        if (workspace === "") continue;
        const resolved = path.resolve(workspace);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        refs.push(resolved);
        const real = realpathSyncOrAncestor(resolved);
        if (real !== null && !seen.has(real)) {
          seen.add(real);
          refs.push(real);
        }
      }
    }
    return refs;
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
    if (this.deps.activity.sessionInUse(sessionId)) return null;
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
    const own = this.deps.layout.agentDir(projectId, agentId);
    const holders = [
      ...(await StorageCleanupService.forms(own)),
      ...(await StorageCleanupService.forms(this.deps.layout.workspacesDir(projectId, agentId))),
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
          const abs = path.join(this.deps.layout.workspacesDir(projectId, agent.agentId), name);
          const { forms, holders } = await this.workspaceForms(projectId, agent.agentId, abs);
          if (isWorkspaceHeld(forms, holders, refs)) continue;
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
          const dir = location.dir(this.deps.layout, projectId, agent.agentId);
          for (const [name, size] of agent.caches.get(location.key) ?? []) {
            if (this.isTrash(dir, name)) continue;
            if (location.inUse(this.deps.activity, { projectId, agentId: agent.agentId, name })) {
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
        const dir = location.dir(this.deps.layout);
        for (const [name, size] of snapshot.server.caches.get(location.key) ?? []) {
          if (this.isTrash(dir, name) || location.inUse(this.deps.activity, { name })) continue;
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

  /** Whether `name`, an entry of a cache location's folder `dir`, is that folder's deleting folder. */
  private isTrash(dir: string, name: string): boolean {
    return path.join(dir, name) === this.deps.folders.deletingDirIn(dir);
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
      place: { place: DeletingPlace; label: string };
    }
    const planned: Planned[] = [];
    for (const id of new Set(request.items)) {
      const ref = parseItemId(id);
      const size = ref === null ? null : this.measured(ref);
      // An item this caller may not clean reads as one that is not there: an id never says
      // whether another Project's folder exists. A location's own deleting folder is never one.
      if (ref === null || size === null || !this.allowed(caller, ref) || this.trashOf(ref)) {
        skipped.push({ id, reason: "gone" });
        continue;
      }
      const abs = itemPath(this.deps.layout, ref);
      const { forms, holders } =
        ref.kind === "workspace"
          ? await this.workspaceForms(ref.projectId, ref.agentId, abs)
          : { forms: [], holders: [] };
      const row = ref.kind === "scratchpad" ? this.deps.sessions.findById(ref.name) : null;
      const listed = row === null || (await this.deps.listingOf(row)) !== null;
      planned.push({
        id,
        ref,
        abs,
        size,
        forms,
        holders,
        listed,
        place: placeFor(this.deps.layout, ref),
      });
    }

    // From here to the last rename nothing awaits: each judgement and its rename happen with no
    // Task able to start in between.
    const refs = this.workspaceRefs();
    const moved: Planned[] = [];
    const aside: string[] = [];
    for (const plan of planned) {
      const verdict = this.judgeNow(plan, refs, request.olderThanDays, now);
      if (verdict !== null) {
        skipped.push({ id: plan.id, reason: verdict });
        continue;
      }
      try {
        const at = this.deps.folders.moveAside(plan.abs, plan.place.place, plan.place.label);
        if (at === null) {
          skipped.push({ id: plan.id, reason: "gone" });
          continue;
        }
        moved.push(plan);
        aside.push(at);
      } catch (err) {
        skipped.push({ id: plan.id, reason: "failed" });
        this.deps.log(`[storage] could not move ${plan.abs} aside: ${(err as Error).message}`);
      }
    }

    const purged = this.deps.folders.purge(aside);
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
        if (isWorkspaceHeld(item.forms, item.holders, refs)) return "in_use";
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
        return ref.location.inUse(this.deps.activity, ref) ? "in_use" : null;
      case "serverCache":
        return ref.location.inUse(this.deps.activity, ref) ? "in_use" : null;
    }
  }

  /** Whether `ref` names its cache location's own deleting folder. */
  private trashOf(ref: ItemRef): boolean {
    if (ref.kind === "serverCache")
      return this.isTrash(ref.location.dir(this.deps.layout), ref.name);
    if (ref.kind === "agentCache") {
      return this.isTrash(ref.location.dir(this.deps.layout, ref.projectId, ref.agentId), ref.name);
    }
    return false;
  }

  /**
   * Has the host remove what an earlier process left in the server cache locations' deleting
   * folders. (What it left in a Project's `agents/.deleting/` the host removes at every start.)
   */
  async resumePurges(): Promise<void> {
    for (const location of cacheLocations("server")) {
      await this.deps.folders.resume(location.dir(this.deps.layout));
    }
  }
}
