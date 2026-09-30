/**
 * Handing a Project's plugin list to the machines that Project was given to.
 *
 * A Session created on a machine runs THERE, so a plugin it needs has to be loaded there:
 * the surface a plugin contributes is offered by the server that will run it, and a create
 * naming a kind that machine does not have is refused by that machine. Without this, a
 * fleet means enabling the same plugin once per machine by hand, and there is no path in
 * the product to do it — the Machines page is how remote is managed. Same problem the Model
 * credentials have, answered the same way (machines/models-sync.ts).
 *
 * STRICT PARITY, decided by the operator (PRFC-0010): what goes over is the Project's whole
 * list, and what the machine has beyond it is removed. That is the literal meaning of "the
 * same plugins everywhere", and it has a cost worth stating at the call site: a
 * platform-specific sandbox backend — `sandbox-winuser` on Windows, `sandbox-bwrap` on Linux —
 * is not in the other's list and is therefore taken away. Keeping one means listing it
 * fleet-wide; a machine that cannot resolve it shows an inert error row rather than losing
 * the backend it can use.
 *
 * WHAT A MACHINE IS HANDED is what the Project asks of THAT machine: the shared `[plugins]`
 * table plus the machine's own `[plugins.<machineId>]` table, its entry winning. Over there
 * it lands as the Project's shared table — the machine runs it, it does not re-share it. A
 * plugin the machine is not asked for is never sent there; one it is asked for and does not
 * list yet is added by that machine's own POST, which takes only what its build ships.
 *
 * The list travels inside the tunnel to the machine's own `PUT /plugins/installed`, an
 * ordinary authenticated call rather than a far-side script: that endpoint validates, writes
 * the Project's config, and does its own hot apply. So a machine running a build new enough
 * loads the plugin without restarting; an older one records the list and reports that it is
 * waiting for a restart, which this sync reports back rather than papering over.
 */
import type { MachineApi } from "./machine-api.js";
import type { InstalledPluginsResponse } from "../api/types.js";

/** What a sync did, in the words the connect log shows. */
export type PluginSyncOutcome =
  | {
      kind: "synced";
      /** Projects whose plugin list was written on that machine (empty = nothing needed it). */
      projects: string[];
      /** Specifiers added over there, across those Projects. */
      added: string[];
      /** Specifiers removed over there because no synced Project asks for them. */
      removed: string[];
      /**
       * Specifiers that machine lists but cannot resolve — most often a machine still on a
       * build that does not ship the plugin. Reported, never silently dropped: it is the
       * operator's choice that is not taking effect there.
       */
      unresolved: string[];
      /** Whether that machine needs a restart before what was written actually loads. */
      restartPending: boolean;
      /** Projects the machine would not take, each with its own reason. */
      refused: { projectId: string; detail: string }[];
    }
  | { kind: "failed"; detail: string };

/** One plugin as a Project asks it of a machine: the package name and, when pinned, its version. */
export interface WantedPlugin {
  name: string;
  version?: string;
}

export interface SyncPluginsOptions {
  api: MachineApi;
  /** This side's half: what the Project asks of this machine, shared and machine-own tables merged. */
  loadLocal: (projectId: string) => Promise<WantedPlugin[]>;
  /** The Projects this machine is used by. */
  projects: readonly string[];
}

/** `PUT /api/projects/:p/plugins/installed` on the far side. */
function pluginsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/plugins/installed`;
}

/**
 * Why that machine answered 404 — the route is not there, or the Project is not there.
 *
 * The two are indistinguishable in the status alone and lead to opposite conclusions, so
 * this asks the one question every build can answer: does it list the Project? Saying "that
 * machine has no such Project" about a Project the models sync had just written, in the line
 * above, sends an operator hunting a fault that does not exist — which is exactly what it did.
 */
async function refusal404(api: MachineApi, projectId: string): Promise<string> {
  const listed = await api.request("GET", "/api/projects");
  if (listed.status === 200) {
    try {
      const projects = (JSON.parse(listed.text) as { projects?: { projectId?: string }[] })
        .projects;
      if (projects?.some((p) => p.projectId === projectId) === true) {
        return "that machine's build is older than the Project plugin list — update it, then sync again";
      }
    } catch {
      // Unreadable list: fall through to the plainer answer below.
    }
  }
  return "that machine has no such Project";
}

/**
 * Writes each Project's list to that machine and reports what changed.
 *
 * A Project the machine does not have is not created here — creating a Project to hold a
 * plugin list would invent a workspace nobody asked for. The models sync creates Projects
 * because a Session cannot run without one; a plugin list has no such claim, so a missing
 * Project is a refusal with its reason.
 */
export async function syncPluginsToMachine(opts: SyncPluginsOptions): Promise<PluginSyncOutcome> {
  const written: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const unresolved: string[] = [];
  const refused: { projectId: string; detail: string }[] = [];
  let restartPending = false;

  for (const projectId of opts.projects) {
    let wanted: WantedPlugin[];
    try {
      wanted = await opts.loadLocal(projectId);
    } catch (err) {
      refused.push({ projectId, detail: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const want = wanted.map((p) => p.name);
    // Read first: without knowing what is there, "added" and "removed" would be guesses, and
    // a machine already in parity would still be written to on every connect.
    const before = await opts.api.request("GET", pluginsPath(projectId));
    if (before.status === 404) {
      refused.push({ projectId, detail: await refusal404(opts.api, projectId) });
      continue;
    }
    if (before.status !== 200) {
      refused.push({ projectId, detail: `GET → ${before.status}: ${before.text.slice(0, 200)}` });
      continue;
    }
    let had: string[];
    let shipped: string[];
    try {
      const parsed = JSON.parse(before.text) as InstalledPluginsResponse;
      // The machine's shared table is the list this sync owns; a row its own machine tables
      // add is not (a build that predates them reports every row as shared).
      had = parsed.plugins.filter((p) => p.everywhere !== false).map((p) => p.specifier);
      shipped = parsed.shipped ?? [];
    } catch {
      refused.push({ projectId, detail: "that machine's plugin list could not be read" });
      continue;
    }
    const same = had.length === want.length && had.every((s, i) => s === want[i]);
    if (same) continue;

    // What the machine lacks and its build does not ship is installed there first: its PUT
    // lists only what is already on its disk. A failed install is reported and left out of
    // the list, so one unreachable package does not keep the rest from arriving.
    const failedInstall = new Set<string>();
    for (const plugin of wanted) {
      if (had.includes(plugin.name) || shipped.includes(plugin.name)) continue;
      const specifier =
        plugin.version === undefined ? plugin.name : `${plugin.name}@${plugin.version}`;
      const res = await opts.api.request("POST", pluginsPath(projectId), { specifier });
      if (res.status !== 200) {
        failedInstall.add(plugin.name);
        refused.push({
          projectId,
          detail: `installing ${specifier} → ${res.status}: ${res.text.slice(0, 200)}`,
        });
      }
    }
    const listed = want.filter((s) => !failedInstall.has(s));
    const res = await opts.api.request("PUT", pluginsPath(projectId), { plugins: listed });
    if (res.status !== 200) {
      refused.push({ projectId, detail: `PUT → ${res.status}: ${res.text.slice(0, 200)}` });
      continue;
    }
    written.push(projectId);
    for (const s of listed) if (!had.includes(s)) added.push(s);
    for (const s of had) if (!listed.includes(s)) removed.push(s);
    try {
      const after = JSON.parse(res.text) as InstalledPluginsResponse;
      if (after.restartPending) restartPending = true;
      for (const row of after.plugins) {
        if (row.error !== undefined && !unresolved.includes(row.specifier)) {
          unresolved.push(row.specifier);
        }
      }
    } catch {
      // The write landed; only the report of it is unreadable.
    }
  }

  return {
    kind: "synced",
    projects: written,
    added: [...new Set(added)],
    removed: [...new Set(removed)],
    unresolved,
    restartPending,
    refused,
  };
}
