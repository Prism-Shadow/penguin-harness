/**
 * What the WAF workspace page shows for the server's state: one status line and its tone,
 * a line per repository, the failure of the last preparation and its log, and whether
 * Prepare may be pressed. Also the settings form's fields and the update a Save sends.
 * Pure, so web vitest can pin it without a DOM.
 */
import type {
  WafRepoId,
  WafRepoStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

/** How often the page asks again while a preparation runs. */
export const WAF_WORKSPACE_POLL_MS = 2000;

export const WAF_REPO_ORDER: readonly WafRepoId[] = [
  "framework",
  "navbar",
  "media",
  "activityData",
];

export interface WafRepoLine {
  id: WafRepoId;
  tone: Tone;
  line: string;
  path: string;
}

export interface WafWorkspaceView {
  tone: Tone;
  /** The state, in words: colour never carries it alone. */
  line: string;
  repos: WafRepoLine[];
  failure: string | null;
  log: string | null;
  canPrepare: boolean;
}

function repoLine(repo: WafRepoStatus, managed: boolean): WafRepoLine {
  const words = S.settings.wafWorkspace.repo;
  const base = { id: repo.id, path: repo.path };
  if (!repo.present) return { ...base, tone: managed ? "attention" : "muted", line: words.missing };
  if (!repo.remoteMatches)
    return { ...base, tone: "danger", line: words.otherRemote(repo.remote ?? words.noRemote) };
  if (repo.installed === false) return { ...base, tone: "attention", line: words.notInstalled };
  return {
    ...base,
    tone: "success",
    line: words.cloned(repo.branch, repo.dirty === true),
  };
}

export function wafWorkspaceView(status: WafWorkspaceStatus): WafWorkspaceView {
  const words = S.settings.wafWorkspace;
  const repos = WAF_REPO_ORDER.flatMap((id) => {
    const repo = status.repos.find((entry) => entry.id === id);
    return repo ? [repoLine(repo, status.managed)] : [];
  });
  const failure = status.preparing || status.lastError === null ? null : status.lastError;
  const line = status.preparing
    ? words.preparing
    : !status.managed
      ? status.ready
        ? words.external(status.root)
        : words.externalMissing(status.root)
      : status.ready
        ? words.ready
        : words.notReady;
  const tone: Tone = status.preparing ? "busy" : status.ready ? "success" : "attention";
  const log = failure !== null && status.log.length ? status.log.join("\n") : null;
  return {
    tone,
    line,
    repos,
    failure,
    log,
    canPrepare: status.managed && !status.preparing,
  };
}

/** Whether the page should keep asking: only while a preparation runs. */
export function shouldPollWafWorkspace(status: WafWorkspaceStatus | null): boolean {
  return status?.preparing === true;
}

/** The settings form: one text value per field, keyed by the path the server names. */
export type WafWorkspaceForm = Record<string, string>;

export function wafFormFromSettings(settings: WafWorkspaceSettings): WafWorkspaceForm {
  const form: WafWorkspaceForm = {
    externalRoot: settings.externalRoot,
    moduleRemote: settings.moduleRemote,
  };
  for (const id of WAF_REPO_ORDER) {
    form[`repos.${id}.remote`] = settings.repos[id].remote;
    form[`repos.${id}.branch`] = settings.repos[id].branch;
  }
  return form;
}

/** What changed since `settings`, as the server's update takes it; null when nothing did. */
export function wafWorkspaceUpdate(
  form: WafWorkspaceForm,
  settings: WafWorkspaceSettings,
): Record<string, unknown> | null {
  const saved = wafFormFromSettings(settings);
  const update: Record<string, unknown> = {};
  const repos: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(form)) {
    if ((saved[key] ?? "") === value.trim()) continue;
    const [head, id, field] = key.split(".");
    if (head === "repos" && id && field) (repos[id] ??= {})[field] = value.trim();
    else update[key] = value.trim();
  }
  if (Object.keys(repos).length) update.repos = repos;
  return Object.keys(update).length ? update : null;
}
