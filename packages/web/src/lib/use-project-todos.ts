/**
 * The two Project-scoped probes behind the dismissible badges, and their shared cache.
 *
 * The plugins trail needs no request at all — `AgentSummary.pluginUpdates` rides along on the
 * Agent list the Project context already loads. The other two do:
 *
 * - **models** — the built-in catalog lives in the client bundle, so the only missing half is
 *   the Project's saved model table. It is read through the models endpoint the page itself
 *   uses, and the delta is computed by the sync action's own code (`catalog-sync.ts`), which is
 *   what keeps the badge from ever leading to a button that answers "already up to date".
 * - **errors** — a one-row page of unexpected errors (`limit: 1`), which is all a badge needs:
 *   `total` is the count and `items[0]` the newest, i.e. the signature a dismissal is stamped
 *   against. The alternative was the cost center's whole dashboard aggregate, for two numbers.
 *
 * The window the error probe asks for is the cost center's OWN default range, not all of
 * history, and that is load-bearing rather than a saving: the page opens on the last 7 days, so
 * counting anything wider would raise a dot leading to a table with no rows in it.
 *
 * Both are cached per Project at module level and fetched once per browser session from the
 * single eager owner (`AppLayout`, through `use-update-badges.ts`); every other anchor reads
 * the cache passively and is pushed the result when it lands. Failures resolve to "nothing
 * known", clear the shared promise so a later activation retries, and surface nothing: an
 * unreachable probe leaves the gate closed and says nothing, exactly like the update check.
 * `refreshProjectTodos` is the acting user: after a sync or a plugin update the answer has
 * changed, and the badge must not wait for a reload to notice. It bumps a per-Project
 * generation so an in-flight probe from before the action cannot land on top of the answer
 * from after it.
 */
import { useEffect, useState } from "react";
import type { ModelsResponse, UsageErrorsPage } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { presetRange } from "../features/usage/usage-controls";

/** The unexpected-error probe's window: the cost center's own default preset (see the header). */
const ERROR_RANGE_PRESET = "7d";

/** What the probes know about one Project; `null` means "not fetched, or the fetch failed". */
export interface ProjectTodoData {
  models: ModelsResponse | null;
  errors: UsageErrorsPage | null;
}

const EMPTY: ProjectTodoData = { models: null, errors: null };

const modelsCache = new Map<string, ModelsResponse>();
const modelsPromise = new Map<string, Promise<ModelsResponse>>();
const errorsCache = new Map<string, UsageErrorsPage>();
const errorsPromise = new Map<string, Promise<UsageErrorsPage>>();
/**
 * The composed pair, kept so a Project's snapshot keeps ONE identity between changes. Consumers
 * memoize the catalog diff on it, and a fresh object on every read would recompute that on every
 * keystroke in the model page's search box. Dropped whenever either half moves.
 */
const snapshotCache = new Map<string, ProjectTodoData>();
/**
 * Refresh generation per Project, bumped by {@link refreshProjectTodos}. A fetch captures the
 * generation it started under and drops its result if a refresh has happened since: without
 * that, a first probe resolving after the post-sync one would reinstate the pre-sync answer and
 * raise a dot over a button that then reports "already up to date" — the case this whole module
 * exists to prevent.
 */
const generation = new Map<string, number>();

/**
 * Mounted hooks subscribe here so any refresh of the module cache reaches every consumer at
 * once — the sidebar's nav dots, the collapsed rail's icons, the mobile menu button and the
 * page notices all react without a remount. Active hooks await the shared promise themselves;
 * passive ones only ever read the cache, and without this push they would miss a result that
 * lands while they are mounted.
 */
const listeners = new Set<() => void>();

function notifyAll(): void {
  for (const notify of listeners) notify();
}

/** Reads the module cache for one Project (the shared EMPTY when nothing is known yet). */
function snapshot(projectId: string | null): ProjectTodoData {
  if (projectId === null) return EMPTY;
  const hit = snapshotCache.get(projectId);
  if (hit) return hit;
  const models = modelsCache.get(projectId) ?? null;
  const errors = errorsCache.get(projectId) ?? null;
  if (models === null && errors === null) return EMPTY;
  const composed = { models, errors };
  snapshotCache.set(projectId, composed);
  return composed;
}

/** Whether a fetch started at `at` still owns its Project's answer (see {@link generation}). */
function current(projectId: string, at: number): boolean {
  return (generation.get(projectId) ?? 0) === at;
}

function fetchModels(projectId: string): void {
  if (modelsPromise.has(projectId)) return;
  const at = generation.get(projectId) ?? 0;
  const promise = api.getModels(projectId).then((res) => {
    if (!current(projectId, at)) return res;
    modelsCache.set(projectId, res);
    snapshotCache.delete(projectId);
    notifyAll();
    return res;
  });
  modelsPromise.set(projectId, promise);
  // Guarded too: a superseded fetch's rejection would otherwise clear the promise the refresh
  // put in its place, and the next mount would fetch a third time.
  promise.catch(() => {
    if (current(projectId, at)) modelsPromise.delete(projectId);
  });
}

function fetchErrors(projectId: string): void {
  if (errorsPromise.has(projectId)) return;
  const at = generation.get(projectId) ?? 0;
  const range = presetRange(ERROR_RANGE_PRESET, new Date());
  const promise = api
    .getUsageErrors(projectId, { offset: 0, limit: 1, kind: "unexpected", ...range })
    .then((res) => {
      if (!current(projectId, at)) return res;
      errorsCache.set(projectId, res);
      snapshotCache.delete(projectId);
      notifyAll();
      return res;
    });
  errorsPromise.set(projectId, promise);
  promise.catch(() => {
    if (current(projectId, at)) errorsPromise.delete(projectId);
  });
}

/**
 * The probes for one Project.
 *
 * `eager` marks the single owner that actually fetches; every other consumer passes false and
 * reads the cache. `wantModels` is the model probe's own gate: syncing presets is an owner-only
 * action, so a member has no control at the end of that trail and the request is not made at
 * all — a badge over a path with nothing actionable on it is worse than no badge.
 */
export function useProjectTodos(
  projectId: string | null,
  eager: boolean,
  wantModels: boolean,
): ProjectTodoData {
  const [data, setData] = useState<ProjectTodoData>(() => snapshot(projectId));

  // Re-sync from the module cache whenever a fetch or a refresh pushes a fresh result.
  useEffect(() => {
    const sync = () => setData(snapshot(projectId));
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [projectId]);

  useEffect(() => {
    if (!eager || projectId === null) return;
    if (wantModels) fetchModels(projectId);
    fetchErrors(projectId);
  }, [eager, projectId, wantModels]);

  return data;
}

/**
 * Drops one Project's cached probes and re-runs the ones already known, then pushes the result.
 * Called after an action that changes what is waiting — syncing presets, updating a plugin — so
 * the badge clears (or does not) on the strength of the server's answer rather than a guess.
 * Only probes that had already run are re-run: refreshing must not make a request a gate had
 * deliberately declined.
 */
export function refreshProjectTodos(projectId: string | null): void {
  if (projectId === null) return;
  const hadModels = modelsPromise.has(projectId);
  const hadErrors = errorsPromise.has(projectId);
  generation.set(projectId, (generation.get(projectId) ?? 0) + 1);
  modelsPromise.delete(projectId);
  errorsPromise.delete(projectId);
  modelsCache.delete(projectId);
  errorsCache.delete(projectId);
  snapshotCache.delete(projectId);
  notifyAll();
  if (hadModels) fetchModels(projectId);
  if (hadErrors) fetchErrors(projectId);
}
