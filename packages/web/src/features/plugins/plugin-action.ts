/**
 * A plugin's one action button, as its card, its row and its page show it (pure decisions, unit
 * tested): what the button says and what a press does, read off where the plugin stands for this
 * reader. Every surface shows the same button in the same state, the way a store's Install / Open
 * button is one button on the list and on the app's page.
 *
 * In order, the first that holds:
 *
 * - **running** — a server change of this plugin is under way: the step it is at, in the card's
 *   one-line words, over the install's staged bar; a press brings back its install steps.
 * - **failed** — its last server install failed: Retry, which opens the server step with why.
 * - **package-update** — an admin, and the sources offer a newer release of the package this
 *   server holds: "Update to vX", confirmed before it runs.
 * - **update** — Agents of the Project carry an older copy: Update, confirmed (it overwrites).
 * - **install** — nothing of it in use yet: Install, which opens the install steps (on the
 *   server's step while the plugin is not there, else on choosing Agents).
 * - **open** — a workbench of it is installed on an Agent of this server: Open.
 * - **agents** — some Agents carry it: how many, which opens choosing Agents.
 * - **server** — a server module: its state in a word ("Installed on server", "Failed to load"),
 *   which opens the server step.
 * - **held** — a member, and a plugin of server modules alone that is not on the server: Install,
 *   held, saying only an admin changes the server.
 *
 * Until this server has said what its own Agents (or its tables) hold, the button is Install,
 * held (`pending`): a count the first answer would overturn is not shown.
 */
import { S } from "../../lib/strings";
import type { ServerStep } from "./plugin-install-flow";
import type { ModuleState, PluginStatus } from "./plugin-status";
import { installStepWords, type DownloadProgress } from "./install-progress";
import type { InstallStage } from "../../api/endpoints";

export type PluginActionKind =
  | "pending"
  | "running"
  | "failed"
  | "package-update"
  | "update"
  | "install"
  | "open"
  | "agents"
  | "server"
  | "held";

export interface PluginAction {
  kind: PluginActionKind;
  label: string;
  /** The button runs nothing: pending, held, or another plugin's server change is running. */
  disabled: boolean;
  /** Why it is held, said on hover. */
  hint?: string;
  /** The button's accent: the next thing to do. A settled state reads in the neutral box. */
  primary: boolean;
}

/** What the button is read from. */
export interface PluginActionInputs {
  /** This server's answer about its own Agents (or its tables) is not in yet. */
  pending: boolean;
  /** This plugin's server change, as the store holds it; null without one. */
  run: {
    phase: "running" | "failed";
    stage: InstallStage | null;
    progress: DownloadProgress | null;
  } | null;
  /** Another plugin's server change is running in the Project: one at a time. */
  blocked: boolean;
  isAdmin: boolean;
  server: ServerStep;
  /** It has something for Agents (Skills, hooks, MCP servers, workbenches). */
  agentContent: boolean;
  /** Its library plugin is on this server, so it can go on an Agent now. */
  onServer: boolean;
  /** A module the build ships whose library plugin also carries Agent content. */
  shippedHybrid: boolean;
  /** How many Agents carry it. */
  agents: number;
  /** How many reachable Agents carry an older copy. */
  behind: number;
  /** The release an admin can update this server's package to; null without one. */
  packageUpdate: string | null;
  /** A workbench of it opens here. */
  canOpen: boolean;
  /** Its server module's state, when it is one. */
  module: ModuleState | undefined;
  status: PluginStatus;
}

export function pluginAction(input: PluginActionInputs): PluginAction {
  const words = S.plugins.installModel;
  if (input.run?.phase === "running") {
    return {
      kind: "running",
      label: installStepWords(input.run.progress, input.run.stage, true),
      disabled: false,
      primary: false,
    };
  }
  if (input.pending) {
    return { kind: "pending", label: S.skills.install, disabled: true, primary: true };
  }
  const held = input.blocked;
  if (input.run?.phase === "failed") {
    return { kind: "failed", label: S.common.retry, disabled: held, primary: true };
  }
  if (input.packageUpdate !== null && input.isAdmin) {
    return {
      kind: "package-update",
      label: S.plugins.updatePackageTo(input.packageUpdate),
      disabled: held,
      primary: true,
    };
  }
  if (input.behind > 0) {
    return { kind: "update", label: S.skills.updateAction, disabled: held, primary: true };
  }
  if (input.shippedHybrid && input.server === "enable") {
    return { kind: "install", label: S.skills.install, disabled: held, primary: true };
  }
  if (input.shippedHybrid && input.server === "unavailable") {
    return {
      kind: "server",
      label: S.plugins.status[input.status],
      disabled: false,
      primary: false,
    };
  }
  if (input.agentContent && input.onServer) {
    if (input.agents === 0) {
      return { kind: "install", label: S.skills.install, disabled: held, primary: true };
    }
    if (input.canOpen)
      return { kind: "open", label: S.plugins.openApp, disabled: false, primary: false };
    return {
      kind: "agents",
      label: S.plugins.marketAgentInstalls(input.agents),
      disabled: false,
      primary: false,
    };
  }
  if (input.module === "active" || input.module === "pending") {
    if (input.server === "done" && !input.agentContent) {
      return {
        kind: "server",
        label: S.plugins.marketServerInstalled,
        disabled: false,
        primary: false,
      };
    }
  }
  if (input.module !== undefined && input.module !== "none" && !input.agentContent) {
    return {
      kind: "server",
      label: S.plugins.status[input.status],
      disabled: false,
      primary: false,
    };
  }
  if (input.server === "held") {
    return {
      kind: "held",
      label: S.skills.install,
      disabled: true,
      hint: words.adminOnly,
      primary: true,
    };
  }
  return { kind: "install", label: S.skills.install, disabled: held, primary: true };
}

/**
 * Every label the button of one plugin may show, so the button is as wide as the widest from the
 * first frame and a change of state moves nothing beside it: the next action, and — while an
 * install may run — each step's words with the widest percent.
 */
export function actionSizes(action: PluginAction, installable: boolean): string[] {
  const words = S.plugins.installModel.stepShort;
  const steps = installable
    ? [words.checking, words.installing, words.loading, S.plugins.downloading(100), S.common.retry]
    : [];
  return [action.label, S.skills.install, ...steps];
}
