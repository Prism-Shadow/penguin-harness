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
 * platform-specific sandbox backend — `sandbox-mxc` on Windows, `sandbox-bwrap` on Linux —
 * is not in the other's list and is therefore taken away. Keeping one means listing it
 * fleet-wide; a machine that cannot resolve it shows an inert error row rather than losing
 * the backend it can use.
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

export interface SyncPluginsOptions {
  api: MachineApi;
  /** This side's half: what the Project asks for. */
  loadLocal: (projectId: string) => Promise<string[]>;
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
    let want: string[];
    try {
      want = await opts.loadLocal(projectId);
    } catch (err) {
      refused.push({ projectId, detail: err instanceof Error ? err.message : String(err) });
      continue;
    }
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
    try {
      had = (JSON.parse(before.text) as InstalledPluginsResponse).plugins.map((p) => p.specifier);
    } catch {
      refused.push({ projectId, detail: "that machine's plugin list could not be read" });
      continue;
    }
    const same = had.length === want.length && had.every((s, i) => s === want[i]);
    if (same) continue;

    const res = await opts.api.request("PUT", pluginsPath(projectId), { plugins: want });
    if (res.status !== 200) {
      refused.push({ projectId, detail: `PUT → ${res.status}: ${res.text.slice(0, 200)}` });
      continue;
    }
    written.push(projectId);
    for (const s of want) if (!had.includes(s)) added.push(s);
    for (const s of had) if (!want.includes(s)) removed.push(s);
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
