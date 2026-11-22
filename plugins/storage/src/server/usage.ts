/**
 * The Storage page's figures: the data root measured unit by unit (./measure.ts) and held in
 * memory, each caller served the part they may see.
 *
 * A unit is a Project's folder, or the server's own top-level entries. A unit is measured when a
 * page first asks for it, and again on Refresh, after a cleanup, and when a review wants figures
 * younger than it has; a measurement already under way is joined, never started twice. Nothing
 * is written to disk: a restarted server measures again when asked. A unit whose measurement
 * fails keeps its last figures and says why.
 *
 * Scope: a user sees the Projects they can open (owner or member), each with its Agents. An admin
 * also sees the whole data root — every Project folder on it, the ones they cannot open summed
 * into one line with no names, and the server's own entries.
 */
import type {
  StorageAgentUsage,
  StorageProjectUsage,
  StorageServerUsage,
  StorageUsage,
} from "../types.js";
import type { ProjectSummary } from "@prismshadow/penguin-server/api";
import type { DataLayout, FsLimiter } from "@prismshadow/penguin-server/plugin";
import { addBytes, emptyBytes } from "./layout.js";
import {
  listProjectDirs,
  measureProject,
  measureServer,
  totalOf,
  type ProjectMeasure,
  type ServerMeasure,
} from "./measure.js";

/** The figures as the service answers them; the route adds what the request decides (`reveal`). */
export type StorageFigures = Omit<StorageUsage, "reveal">;

/** Who asks. */
export interface StorageCaller {
  userId: string;
  isAdmin: boolean;
}

/** What the figures reach. */
export interface StorageUsageDeps {
  layout: DataLayout;
  limiter: FsLimiter;
  /** Ends every measurement of this generation. */
  signal: AbortSignal;
  /** The Projects the user can open, with their display names. */
  listProjects(userId: string): Promise<ProjectSummary[]>;
  /** Whether the Project index has a row for the id. */
  isIndexedProject(projectId: string): boolean;
  /** An Agent's display name (its id when it has none or cannot be read). */
  agentName(projectId: string, agentId: string): Promise<string>;
  /** Wall clock, ms. */
  now(): number;
  log(line: string): void;
}

/** One unit's figures and the measurement under way, if any. */
interface Unit<T> {
  value: T | null;
  /** When `value` was measured, ms. */
  at: number;
  error: string | null;
  running: Promise<void> | null;
}

/** A Project unit's figures, with its Agents' display names read once per measurement. */
export interface ProjectFigures extends ProjectMeasure {
  agentNames: Map<string, string>;
}

/** The figures a review or a list works from, as of `measuredAt`. */
export interface StorageSnapshot {
  /** The oldest measurement among the units, ms. */
  measuredAt: number;
  projects: Map<string, ProjectFigures>;
  server: ServerMeasure | null;
}

const blank = <T>(): Unit<T> => ({ value: null, at: 0, error: null, running: null });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class StorageUsageService {
  private readonly projectUnits = new Map<string, Unit<ProjectFigures>>();
  private readonly serverUnit: Unit<ServerMeasure> = blank();

  constructor(private readonly deps: StorageUsageDeps) {}

  /**
   * The ids of every unit in the caller's scope: their Projects, and for an admin every Project
   * folder on the data root besides. Reading the top level is cheap; its entries are not walked.
   */
  private async scope(
    caller: StorageCaller,
  ): Promise<{ mine: ProjectSummary[]; projectIds: string[]; server: boolean }> {
    const mine = await this.deps.listProjects(caller.userId);
    const ids = new Set(mine.map((p) => p.projectId));
    if (caller.isAdmin) {
      for (const id of await this.projectDirs()) ids.add(id);
    }
    return { mine, projectIds: [...ids].sort(), server: caller.isAdmin };
  }

  private projectDirs(): Promise<string[]> {
    return listProjectDirs(this.deps.layout, (id) => this.deps.isIndexedProject(id), {
      limiter: this.deps.limiter,
      signal: this.deps.signal,
    });
  }

  private projectUnit(projectId: string): Unit<ProjectFigures> {
    let unit = this.projectUnits.get(projectId);
    if (unit === undefined) {
      unit = blank();
      this.projectUnits.set(projectId, unit);
    }
    return unit;
  }

  /** Measures a unit unless a measurement of it is under way; resolves when the unit's current one ends. */
  private run<T>(unit: Unit<T>, measure: () => Promise<T>): Promise<void> {
    if (unit.running !== null) return unit.running;
    const running = (async () => {
      try {
        const value = await measure();
        unit.value = value;
        unit.at = this.deps.now();
        unit.error = null;
      } catch (err) {
        if (this.deps.signal.aborted) return;
        unit.error = message(err);
        this.deps.log(`[storage] measuring failed: ${unit.error}`);
      } finally {
        unit.running = null;
      }
    })();
    unit.running = running;
    return running;
  }

  private measureProjectUnit(projectId: string): Promise<void> {
    const opts = { limiter: this.deps.limiter, signal: this.deps.signal };
    return this.run(this.projectUnit(projectId), async () => {
      const measured = await measureProject(this.deps.layout, projectId, opts);
      const agentNames = new Map<string, string>();
      for (const agentId of measured.agents.keys()) {
        agentNames.set(agentId, await this.deps.agentName(projectId, agentId));
      }
      return { ...measured, agentNames };
    });
  }

  private measureServerUnit(): Promise<void> {
    const opts = { limiter: this.deps.limiter, signal: this.deps.signal };
    return this.run(this.serverUnit, async () => {
      return measureServer(this.deps.layout, await this.projectDirs(), opts);
    });
  }

  /** Starts (or joins) a measurement of each unit named; `all: false` skips units that have figures. */
  private start(projectIds: readonly string[], server: boolean, all: boolean): Promise<void>[] {
    const runs: Promise<void>[] = [];
    for (const id of projectIds) {
      const unit = this.projectUnit(id);
      if (all || (unit.value === null && unit.error === null) || unit.running !== null) {
        runs.push(this.measureProjectUnit(id));
      }
    }
    if (server) {
      const unit = this.serverUnit;
      if (all || (unit.value === null && unit.error === null) || unit.running !== null) {
        runs.push(this.measureServerUnit());
      }
    }
    return runs;
  }

  /**
   * The caller's figures as they stand. A unit never measured starts measuring now; `refresh`
   * measures every unit in scope again (joining any under way). Answers at once — `measuring`
   * says whether more is coming.
   */
  async usage(caller: StorageCaller, opts: { refresh?: boolean } = {}): Promise<StorageFigures> {
    const scope = await this.scope(caller);
    // Fire and forget: a unit's measurement records its own failure and never rejects.
    this.start(scope.projectIds, scope.server, opts.refresh === true);
    return this.view(caller, scope);
  }

  /**
   * Figures no older than `maxAgeMs` for every unit in the caller's scope, measuring the ones
   * that are older (or joining their measurement). What a review works from.
   */
  async fresh(caller: StorageCaller, maxAgeMs: number): Promise<StorageSnapshot> {
    const scope = await this.scope(caller);
    const now = this.deps.now();
    const stale = scope.projectIds.filter((id) => {
      const unit = this.projectUnit(id);
      return unit.running !== null || unit.value === null || now - unit.at > maxAgeMs;
    });
    const serverStale =
      scope.server &&
      (this.serverUnit.running !== null ||
        this.serverUnit.value === null ||
        now - this.serverUnit.at > maxAgeMs);
    await Promise.all(this.start(stale, serverStale, true));
    const projects = new Map<string, ProjectFigures>();
    let measuredAt = now;
    for (const id of scope.projectIds) {
      const unit = this.projectUnit(id);
      if (unit.value === null) {
        if (unit.error !== null) throw new Error(unit.error);
        continue;
      }
      projects.set(id, unit.value);
      measuredAt = Math.min(measuredAt, unit.at);
    }
    let server: ServerMeasure | null = null;
    if (scope.server) {
      if (this.serverUnit.value === null && this.serverUnit.error !== null) {
        throw new Error(this.serverUnit.error);
      }
      server = this.serverUnit.value;
      if (server !== null) measuredAt = Math.min(measuredAt, this.serverUnit.at);
    }
    return { measuredAt, projects, server };
  }

  /**
   * Measures the named units again once `after` settles (a cleanup's purge), in the background.
   * They read as measuring from now on: a page that asks meanwhile keeps polling, and sees the
   * figures the removal left.
   */
  remeasureAfter(projectIds: readonly string[], server: boolean, after: Promise<unknown>): void {
    const units: Array<[Unit<unknown>, () => Promise<void>]> = projectIds.map((id) => [
      this.projectUnit(id),
      () => this.measureProjectUnit(id),
    ]);
    if (server) units.push([this.serverUnit, () => this.measureServerUnit()]);
    for (const [unit, measure] of units) {
      const before = unit.running;
      const hold: { running: Promise<void> | null } = { running: null };
      hold.running = (async () => {
        await Promise.allSettled([before, after]);
        // The measurement below sets `running` to its own promise; this hold lets go first.
        if (unit.running === hold.running) unit.running = null;
        if (!this.deps.signal.aborted) await measure();
      })();
      unit.running = hold.running;
    }
  }

  /** A Project's last figures, if it has been measured. */
  projectFigures(projectId: string): ProjectFigures | null {
    return this.projectUnits.get(projectId)?.value ?? null;
  }

  /** The server unit's last figures, if it has been measured. */
  serverFigures(): ServerMeasure | null {
    return this.serverUnit.value;
  }

  /** The wire answer for `caller` from the units' current figures. */
  private view(
    caller: StorageCaller,
    scope: { mine: ProjectSummary[]; projectIds: string[]; server: boolean },
  ): StorageFigures {
    const units: Unit<unknown>[] = scope.projectIds.map((id) => this.projectUnit(id));
    if (scope.server) units.push(this.serverUnit);
    const measuring = units.some((u) => u.running !== null);
    // Nothing in scope (a user with no Project) is measured by definition, as of now.
    const measuredAt =
      units.length === 0
        ? this.deps.now()
        : units.every((u) => u.value !== null)
          ? Math.min(...units.map((u) => u.at))
          : null;
    const error = units.find((u) => u.error !== null)?.error ?? null;

    const categories = emptyBytes();
    const projects: StorageProjectUsage[] = scope.mine.map((summary) => {
      const figures = this.projectUnit(summary.projectId).value;
      const agents: StorageAgentUsage[] = [...(figures?.agents.values() ?? [])]
        .map((agent) => ({
          agentId: agent.agentId,
          name: figures?.agentNames.get(agent.agentId) ?? agent.agentId,
          bytes: agent.bytes,
          categories: agent.categories,
        }))
        .sort((a, b) => b.bytes - a.bytes || (a.agentId < b.agentId ? -1 : 1));
      const own = figures?.categories ?? emptyBytes();
      addBytes(categories, own);
      return {
        projectId: summary.projectId,
        name: summary.name ?? summary.projectId,
        path: this.deps.layout.projectDir(summary.projectId),
        bytes: figures?.bytes ?? 0,
        categories: own,
        agents,
      };
    });
    projects.sort((a, b) => b.bytes - a.bytes || (a.projectId < b.projectId ? -1 : 1));

    const answer: StorageFigures = {
      measuredAt: measuredAt === null ? null : new Date(measuredAt).toISOString(),
      measuring,
      ...(error !== null ? { error } : {}),
      bytes: totalOf(categories),
      categories,
      projects,
    };
    if (caller.isAdmin) answer.server = this.serverView(scope);
    return answer;
  }

  private serverView(scope: { mine: ProjectSummary[]; projectIds: string[] }): StorageServerUsage {
    const own = this.serverUnit.value;
    const categories = emptyBytes();
    if (own !== null) addBytes(categories, own.categories);
    const mine = new Set(scope.mine.map((p) => p.projectId));
    const otherProjects = { count: 0, bytes: 0 };
    for (const id of scope.projectIds) {
      const figures = this.projectUnit(id).value;
      if (figures !== null) addBytes(categories, figures.categories);
      if (mine.has(id)) continue;
      otherProjects.count += 1;
      otherProjects.bytes += figures?.bytes ?? 0;
    }
    return {
      root: this.deps.layout.root(),
      bytes: totalOf(categories),
      categories,
      otherProjects,
      entries: own?.entries ?? [],
    };
  }
}
