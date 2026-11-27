/**
 * The server changes the plugin market starts — an install on the server (or on a machine, whose
 * list this server keeps), a package update, a removal — kept for the page load rather than by
 * the page that started them. A change runs on while the person goes from the grid to a plugin's
 * page and back, or leaves the market altogether, and every surface that shows the plugin reads
 * where it stands from here: its card's button, its page's button, its install steps, and the
 * update on an Agent's Plugins tab. Nothing is lost by closing or navigating; only the server can
 * stop a change, and it never does halfway (an install cannot be cancelled).
 *
 * One change at a time per Project: the server re-assembles the App after each, so the cards of
 * the other plugins hold their button while one runs rather than queueing behind it.
 *
 * A run is keyed by the Project, the machine whose list it writes and the package. While it runs
 * it holds the server's last report (the stage, and a channel download's amount); an install that
 * failed stays, with why and where it stopped, until the next attempt or until it is dismissed;
 * one that finished leaves, and the reads it moved are read again or take its answer.
 *
 * Its answer is this server's list for the Project, which the read store takes only while nothing
 * newer has been asked: a read that started or answered after the change started may already know
 * more than the change's answer, so the key is read again instead of overwritten.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import { toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { failureOf, toldFailure } from "../../lib/failure";
import { notifyPluginsChanged } from "../../lib/project-change-events";
import { S } from "../../lib/strings";
import { toastApiError, toastFailure } from "../../lib/toast-api-error";
import type { DownloadProgress } from "./install-progress";
import type { InstallFailure } from "./plugin-install-flow";
import {
  INDEX_KEY,
  LIBRARY_KEY,
  installedPlugins,
  installedPluginsKey,
  pluginIndex,
  pluginLibrary,
} from "./plugin-reads";

/** What a change writes: which package, on which machine's list, for which Project. */
export interface ServerChange {
  projectId: string;
  /** The machine whose list it writes: this server's id, or a machine's. */
  machineId: string;
  specifier: string;
  /** True installs (or enables, or updates to `version`); false removes. */
  install: boolean;
  /** The release to install, when it is not the newest the sources offer. */
  version?: string;
  /** How a toast names the plugin. */
  title: string;
  /** A package update: its own words, and a failure said in a toast rather than kept. */
  update?: boolean;
}

/** One change as it stands: running, or an install that failed and is kept until dismissed. */
export interface ServerRun {
  projectId: string;
  machineId: string;
  specifier: string;
  install: boolean;
  update: boolean;
  phase: "running" | "failed";
  stage: api.InstallStage | null;
  progress: DownloadProgress | null;
  failure: InstallFailure | null;
  /** When it started, for the read store's newer-answer check. */
  startedAt: number;
}

/** What the page that started a change adds once it lands, when it still can. */
export interface ServerChangeHooks {
  /** This server's id: a change for another machine reads that machine again. */
  selfId: string | undefined;
  /** Reads again what the machine named by the change runs (it applies the list on its own). */
  rereadMachine?: () => Promise<void>;
  /** Reads the Agent list again (an install may have landed Agent content). */
  reloadAgents?: () => Promise<unknown>;
}

const SEP = "\u0000";
export const runKey = (projectId: string, machineId: string, specifier: string) =>
  `${projectId}${SEP}${machineId}${SEP}${specifier}`;

const store = createStore<{ runs: Readonly<Record<string, ServerRun>> }>(() => ({ runs: {} }));

function put(key: string, run: ServerRun | null): void {
  store.setState(({ runs }) => {
    const next = { ...runs };
    if (run === null) delete next[key];
    else next[key] = run;
    return { runs: next };
  });
}

function patch(key: string, change: Partial<ServerRun>): void {
  const run = store.getState().runs[key];
  if (run !== undefined) put(key, { ...run, ...change });
}

/** The change of one package on one machine's list, running or failed; null without one. */
export function serverRun(
  projectId: string,
  machineId: string,
  specifier: string,
): ServerRun | null {
  return store.getState().runs[runKey(projectId, machineId, specifier)] ?? null;
}

/** The change running in a Project, if one is. */
export function runningChange(projectId: string | null): ServerRun | null {
  if (projectId === null) return null;
  return (
    Object.values(store.getState().runs).find(
      (run) => run.projectId === projectId && run.phase === "running",
    ) ?? null
  );
}

/** {@link serverRun}, kept current. */
export function useServerRun(
  projectId: string | null,
  machineId: string | undefined,
  specifier: string | undefined,
): ServerRun | null {
  return useStore(store, ({ runs }) =>
    projectId === null || machineId === undefined || specifier === undefined
      ? null
      : (runs[runKey(projectId, machineId, specifier)] ?? null),
  );
}

/** Every run of a Project, kept current: what the market's cards read theirs from. */
export function useServerRuns(projectId: string | null): Readonly<Record<string, ServerRun>> {
  const runs = useStore(store, (state) => state.runs);
  if (projectId === null) return {};
  return runs;
}

/** {@link runningChange}, kept current. */
export function useRunningChange(projectId: string | null): ServerRun | null {
  return useStore(store, ({ runs }) =>
    projectId === null
      ? null
      : (Object.values(runs).find(
          (run) => run.projectId === projectId && run.phase === "running",
        ) ?? null),
  );
}

/** Forgets a failed install (its note's Dismiss); a running one stays. */
export function dismissServerFailure(
  projectId: string,
  machineId: string,
  specifier: string,
): void {
  const key = runKey(projectId, machineId, specifier);
  if (store.getState().runs[key]?.phase === "failed") put(key, null);
}

/**
 * Takes the change's answer into this server's list for the Project, unless a read asked after
 * the change started is in flight or has answered: then that key is read again, and the newest
 * ask is what shows.
 */
function settleList(projectId: string, next: InstalledPluginsResponse, startedAt: number): void {
  const key = installedPluginsKey(projectId, null);
  const now = installedPlugins.get(key);
  if (!now.reading && (now.at === null || now.at <= startedAt)) installedPlugins.accept(key, next);
  else installedPlugins.invalidate(key);
}

/**
 * Runs a change on the server, unless one is already running in its Project (then nothing
 * happens and false is answered). The run is in the store from the first moment; the page's
 * hooks run once it lands, whether or not the page is still on screen — each only reads again.
 */
export async function runServerChange(
  change: ServerChange,
  hooks: ServerChangeHooks,
): Promise<boolean> {
  if (runningChange(change.projectId) !== null) return false;
  const key = runKey(change.projectId, change.machineId, change.specifier);
  const startedAt = Date.now();
  put(key, {
    projectId: change.projectId,
    machineId: change.machineId,
    specifier: change.specifier,
    install: change.install,
    update: change.update === true,
    phase: "running",
    stage: null,
    progress: null,
    failure: null,
    startedAt,
  });
  // The server's last report, kept for a failure to say where the install stopped.
  let lastStage: api.InstallStage | null = null;
  let lastProgress: DownloadProgress | null = null;
  const here = change.machineId === hooks.selfId;
  try {
    const next = change.install
      ? await api.installPluginStream(
          change.projectId,
          change.version ? `${change.specifier}@${change.version}` : change.specifier,
          change.machineId,
          (received, total) => {
            lastProgress = { received, total };
            patch(key, { progress: lastProgress });
          },
          (stage) => {
            lastStage = stage;
            lastProgress = null;
            // A download belongs to one source: the next step's words replace its percent.
            patch(key, { stage, progress: null });
          },
        )
      : await api.uninstallPlugin(change.projectId, change.specifier, change.machineId);
    notifyPluginsChanged(change.projectId);
    // A machine is handed its part in the background: its card keeps the state it had until the
    // machine is asked again, and the tables' new answer is taken together with the machine's.
    if (!here && hooks.rereadMachine !== undefined) {
      await hooks.rereadMachine().catch(() => undefined);
    }
    settleList(change.projectId, next, startedAt);
    // What landed may carry Agent content: the library (and the registry's rows) are read
    // again, so the plugin's next step — choosing its Agents — opens without a reload.
    if (change.install && here) {
      pluginLibrary.invalidate(LIBRARY_KEY);
      pluginIndex.invalidate(INDEX_KEY);
      void hooks.reloadAgents?.().catch(() => undefined);
    }
    put(key, null);
    said(change, next);
    return true;
  } catch (e) {
    if (change.install && change.update !== true) {
      put(key, {
        ...(store.getState().runs[key] ?? {
          projectId: change.projectId,
          machineId: change.machineId,
          specifier: change.specifier,
          install: true,
          update: false,
          startedAt,
        }),
        phase: "failed",
        stage: lastStage,
        progress: lastProgress,
        failure: {
          failure: failureOf(e, { what: "a plugin could not be installed on the server" }),
          stage: lastStage,
          progress: lastProgress,
        },
      } as ServerRun);
    } else {
      put(key, null);
      if (change.update === true) {
        toastApiError(e, {
          what: "a plugin package could not be updated",
          text: S.plugins.packageUpdateFailed(change.title, apiErrorText(e)),
        });
      } else toastApiError(e);
    }
    return false;
  }
}

/** The toast a landed change says: what the running process now has, a load failure included. */
function said(change: ServerChange, next: InstalledPluginsResponse): void {
  const { specifier, title } = change;
  const row = next.plugins.find((p) => p.specifier === specifier);
  if (!change.install) {
    toastSuccess(S.common.saved);
    return;
  }
  const reason = row?.error ?? (change.update === true ? row?.unsatisfied?.reason : undefined);
  if (next.loading === true) toastSuccess(S.plugins.installModel.loadingToast(title));
  else if (reason !== undefined) {
    toastFailure(
      toldFailure(S.plugins.deploymentFailedToast(title, reason), {
        what: "a plugin failed to load after it was installed",
        facts: [["Plugin", specifier]],
        detail: reason,
      }),
    );
  } else if (change.update === true && change.version !== undefined) {
    toastSuccess(S.plugins.packageUpdated(title, change.version));
  } else if (next.installed?.from === "offline") {
    toastSuccess(S.plugins.installModel.offlineToast(title));
  } else toastSuccess(S.plugins.deploymentInstalledToast(title));
}

/** Clears every run: a test's fresh start. */
export function resetServerRuns(): void {
  store.setState({ runs: {} });
}
