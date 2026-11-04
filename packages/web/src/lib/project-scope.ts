/**
 * Project-scoped state, and the one rule every surface that holds it follows.
 *
 * The Web App shows one Project at a time, and the user can switch while answers are still in
 * flight — on a slow machine, while the previous Project's lists are still loading. Anything read
 * for a Project (its Agents, its Sessions, an Agent's config) is true of that Project only. So:
 *
 * - **Every Project-scoped answer carries the Project it was asked for**, and is applied only
 *   while that Project is still the current one (`isCurrentProject`). A late answer for A that
 *   lands after the switch to B is dropped; it must not overwrite what B already shows.
 * - **Held state is tagged with the Project it was read for** (`Scoped`), and read through
 *   `scopedValue`, which hands it out only for that Project. A provider or page that resets its
 *   state in an effect lags `useProject()` by one commit — the descendants' effects run first —
 *   and in that commit an untagged value would pair B with A's Agents, A's rows, A's config.
 * - **A row that names its own Project** (`SessionInfo.projectId`) is used only under that
 *   Project (`ofProject`).
 *
 * The tag can be finer than the Project: an Agent's config or listing is scoped to the Agent
 * within the Project (and the machine holding it), keyed with `scopeKey`.
 */

/** A value and the scope it was read for — a Project, or an Agent within one (`scopeKey`). */
export interface Scoped<T> {
  readonly scope: string;
  readonly value: T;
}

/** Tags `value` with the scope it was read for. */
export function scoped<T>(scope: string, value: T): Scoped<T> {
  return { scope, value };
}

/** `held`'s value when it was read for `scope`; null for any other scope, or none. */
export function scopedValue<T>(held: Scoped<T> | null, scope: string | null): T | null {
  return held !== null && scope !== null && held.scope === scope ? held.value : null;
}

/**
 * The scope key of a Project, or of one Agent in it — on a machine, when given (an Agent id
 * names a different Agent on each server). Null while the Project or the named Agent is unknown.
 */
export function scopeKey(
  projectId: string | null,
  agentId?: string | null,
  machineId?: string | null,
): string | null {
  if (projectId === null) return null;
  if (agentId === undefined) return projectId;
  if (agentId === null) return null;
  return JSON.stringify([projectId, agentId, machineId ?? null]);
}

/** Whether an answer asked for `askedFor` may still be applied: that Project is still current. */
export function isCurrentProject(askedFor: string | null, current: string | null): boolean {
  return askedFor !== null && askedFor === current;
}

/** Whether a row that names its own Project belongs under `projectId`. */
export function ofProject(
  row: { readonly projectId: string } | null | undefined,
  projectId: string | null,
): boolean {
  return row != null && projectId !== null && row.projectId === projectId;
}
